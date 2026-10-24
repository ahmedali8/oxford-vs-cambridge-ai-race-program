// Reference verifier: reads the chain and reports which tiers each team has passed.
// This is the exact logic Agent Studio's verifier should run; it is also the organisers'
// manual fallback if the platform has a problem.
//
// Usage: bun scripts/check.ts <teamId> [<teamId> ...]
//        bun scripts/check.ts --csv teams.csv
//        [--fast-slots 150]
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  arg,
  clearancePda,
  configPda,
  connect,
  decodeConfig,
  decodeHoldings,
  decodeVerificationRecord,
  holdingsPda,
  loadConfig,
  memos,
  recordPda,
  sha256,
  signers,
  tokenTransfers,
  u64le,
  type RaceConfig,
} from "./lib.ts";

export const POINTS = { operation: [30, 50, 70], minesweeper: [90, 80, 30] } as const;

export interface TierResult {
  passed: [boolean, boolean, boolean];
  note: string;
}

const getTx = (connection: Connection, signature: string): Promise<ParsedTransactionWithMeta | null> =>
  connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

async function teamWallet(connection: Connection, programId: PublicKey, teamId: string): Promise<string | null> {
  const holdings = await connection.getAccountInfo(holdingsPda(programId, teamId));
  return holdings ? decodeHoldings(holdings.data).registrarKey.toBase58() : null;
}

/**
 * Operation.
 *  Tier 1: a transfer authorised by the team wallet landed on the team's clearance account.
 *  Tier 2: a transfer of exactly 1000 + (nonce mod 9000) base units landed there.
 *  Tier 3: that exact transfer and the correct memo are in the same transaction.
 */
export async function checkOperation(connection: Connection, config: RaceConfig, teamId: string): Promise<TierResult> {
  const programId = new PublicKey(config.programId);
  const recordAccount = await connection.getAccountInfo(recordPda(programId, teamId));
  const wallet = await teamWallet(connection, programId, teamId);
  if (!recordAccount || !wallet) return { passed: [false, false, false], note: "team not set up on chain" };

  const record = decodeVerificationRecord(recordAccount.data);
  const clearanceAta = record.clearanceAta.toBase58();
  const expectedAmount = 1000n + (record.clearanceNonce % 9000n);
  const expectedMemo = sha256(Buffer.from(teamId, "utf8"), u64le(record.clearanceNonce)).toString("hex").slice(0, 16);

  const passed: [boolean, boolean, boolean] = [false, false, false];
  const signatures = await connection.getSignaturesForAddress(record.clearanceAta, { limit: 1000 });
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await getTx(connection, entry.signature);
    if (!tx || tx.meta?.err) continue;
    const txMemos = memos(tx);
    for (const transfer of tokenTransfers(tx)) {
      if (transfer.destination !== clearanceAta || transfer.authority !== wallet) continue;
      passed[0] = true;
      if (transfer.amount === expectedAmount) {
        passed[1] = true;
        if (txMemos.includes(expectedMemo)) passed[2] = true;
      }
    }
    if (passed[2]) break;
  }
  return { passed, note: "" };
}

/** The code the program wrote for one mint: bs58(sha256(team ‖ memo_hash ‖ slot_le))[..8]. */
export function clearanceCode(teamId: string, memoHash: Buffer, slot: bigint): string {
  return bs58.encode(sha256(Buffer.from(teamId, "utf8"), memoHash, u64le(slot))).slice(0, 8);
}

/**
 * Every successful mint_code for this team signed by the team's own wallet, with the code it
 * produced. mint_code is permissionless, so another team can mint (and overwrite) a code for
 * you; only your own mints count, and each one stays presentable even if it was overwritten.
 */
async function ownMints(connection: Connection, programId: PublicKey, teamId: string, wallet: string) {
  const mintDiscriminator = sha256("global:mint_code").subarray(0, 8);
  const mints: { slot: bigint; code: string }[] = [];
  const signatures = await connection.getSignaturesForAddress(clearancePda(programId, teamId), { limit: 1000 });
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await getTx(connection, entry.signature);
    if (!tx || tx.meta?.err || !signers(tx).includes(wallet)) continue;
    for (const ix of tx.transaction.message.instructions) {
      if (!("data" in ix) || !ix.programId.equals(programId)) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (!data.subarray(0, 8).equals(mintDiscriminator)) continue;
      mints.push({ slot: BigInt(tx.slot), code: clearanceCode(teamId, data.subarray(data.length - 32), BigInt(tx.slot)) });
    }
  }
  return mints;
}

/**
 * Minesweeper.
 *  Tier 1: the team's own wallet signed a successful mint_code for the team.
 *  Tier 2: a transaction signed by the team wallet, touching the presentation account, carries the
 *          memo "<teamId>:<code>" for one of the team's own mints, within code_window_slots of it.
 *  Tier 3: as tier 2, within fastSlots of that mint.
 */
export async function checkMinesweeper(connection: Connection, config: RaceConfig, teamId: string, fastSlots: number): Promise<TierResult> {
  const programId = new PublicKey(config.programId);
  const wallet = await teamWallet(connection, programId, teamId);
  if (!wallet) return { passed: [false, false, false], note: "team not set up on chain" };

  const mints = await ownMints(connection, programId, teamId, wallet);
  if (mints.length === 0) return { passed: [false, false, false], note: "no code minted by the team wallet yet" };
  const windowSlots = decodeConfig((await connection.getAccountInfo(configPda(programId)))!.data).codeWindowSlots;

  const passed: [boolean, boolean, boolean] = [true, false, false];
  const signatures = await connection.getSignaturesForAddress(new PublicKey(config.presentationAccount), { limit: 1000 });
  for (const entry of signatures) {
    // The signature list includes memo text, so other teams' presentations are skipped cheaply.
    if (entry.err || !entry.memo?.includes(`${teamId}:`)) continue;
    const tx = await getTx(connection, entry.signature);
    if (!tx || tx.meta?.err || !signers(tx).includes(wallet)) continue;
    const txMemos = memos(tx);
    for (const mint of mints) {
      const age = BigInt(tx.slot) - mint.slot;
      if (age < 0n || age > windowSlots || !txMemos.includes(`${teamId}:${mint.code}`)) continue;
      passed[1] = true;
      if (age <= BigInt(fastSlots)) passed[2] = true;
    }
    if (passed[2]) break;
  }
  return { passed, note: "" };
}

function score(result: TierResult, points: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < 3; i += 1) {
    if (!result.passed[i]) break; // tiers are sequential
    total += points[i]!;
  }
  return total;
}

if (import.meta.main) {
  const config = loadConfig();
  const connection = connect(config.rpcUrl);
  const fastSlots = Number(arg("fast-slots", "150"));
  const csv = arg("csv");
  const teamIds = csv
    ? readFileSync(csv, "utf8").split(/\r?\n/).map((l) => l.split(",")[0]!.trim()).filter((id) => id && !id.startsWith("#") && id.toLowerCase() !== "challengeid")
    : process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== arg("fast-slots"));
  if (teamIds.length === 0) {
    console.error("Usage: bun scripts/check.ts <teamId> [...]  or  --csv teams.csv");
    process.exit(1);
  }

  const mark = (p: boolean) => (p ? "✔" : "·");
  console.log("team              operation 1 2 3   minesweeper 1 2 3   points  notes");
  for (const teamId of teamIds) {
    const op = await checkOperation(connection, config, teamId);
    const ms = await checkMinesweeper(connection, config, teamId, fastSlots);
    const points = score(op, POINTS.operation) + score(ms, POINTS.minesweeper);
    const notes = [op.note && `operation: ${op.note}`, ms.note && `minesweeper: ${ms.note}`].filter(Boolean).join("; ");
    console.log(
      `${teamId.padEnd(16)}            ${op.passed.map(mark).join(" ")}               ${ms.passed.map(mark).join(" ")}   ${String(points).padStart(6)}  ${notes}`,
    );
  }
}
