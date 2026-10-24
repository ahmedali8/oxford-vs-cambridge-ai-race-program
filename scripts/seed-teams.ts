// Sets up every team listed in a CSV (`challengeId,wallet`, one per line):
//   - funds the team wallet with SOL (fees) and CRED, only the first time;
//   - creates the team's own clearance token account (owned by its verification record);
//   - writes the team's verification record (random clearance nonce) and holdings record
//     (registrar_key = team wallet).
// Safe to rerun: anything that already exists is skipped, so late teams can be added later.
//
// Usage: bun scripts/seed-teams.ts teams.csv [--keypair keys/admin.json] [--sol 0.05] [--cred 100]
import { readFileSync } from "node:fs";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  arg,
  connect,
  CRED_DECIMALS,
  fail,
  holdingsPda,
  initTeamHoldingsIx,
  initTeamIx,
  loadConfig,
  loadKeypair,
  randomNonce,
  recordPda,
  send,
  TEAM_ID_PATTERN,
} from "./lib.ts";

const csvPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "teams.csv";
const admin = loadKeypair(arg("keypair", "keys/admin.json")!);
const solPerTeam = Number(arg("sol", "0.05"));
const credPerTeam = BigInt(arg("cred", "100")!) * 10n ** BigInt(CRED_DECIMALS);
const config = loadConfig();
const connection = connect(config.rpcUrl);
const programId = new PublicKey(config.programId);
const mint = new PublicKey(config.credMint);

const teams = readFileSync(csvPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.toLowerCase().startsWith("challengeid"))
  .map((line, index) => {
    const [teamId, wallet] = line.split(",").map((cell) => cell.trim());
    if (!teamId || !TEAM_ID_PATTERN.test(teamId)) fail(`Line ${index + 1}: team ID must be 1-16 letters, digits or dashes (got "${teamId}")`);
    try {
      return { teamId, wallet: new PublicKey(wallet ?? "") };
    } catch {
      fail(`Line ${index + 1}: "${wallet}" is not a Solana address`);
    }
  });

const exists = async (address: PublicKey) => (await connection.getAccountInfo(address)) !== null;

for (const { teamId, wallet } of teams) {
  const instructions: TransactionInstruction[] = [];
  const notes: string[] = [];

  const teamTokenAccount = getAssociatedTokenAddressSync(mint, wallet);
  if (!(await exists(teamTokenAccount))) {
    instructions.push(
      createAssociatedTokenAccountInstruction(admin.publicKey, teamTokenAccount, wallet, mint),
      createMintToInstruction(mint, teamTokenAccount, admin.publicKey, credPerTeam),
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet, lamports: Math.round(solPerTeam * LAMPORTS_PER_SOL) }),
    );
    notes.push("funded");
  }

  const record = recordPda(programId, teamId);
  const clearanceAta = getAssociatedTokenAddressSync(mint, record, true);
  if (!(await exists(clearanceAta))) {
    instructions.push(createAssociatedTokenAccountInstruction(admin.publicKey, clearanceAta, record, mint));
    notes.push("clearance account");
  }
  if (!(await exists(record))) {
    instructions.push(initTeamIx(programId, admin.publicKey, teamId, randomNonce(), clearanceAta));
    notes.push("verification record");
  }
  if (!(await exists(holdingsPda(programId, teamId)))) {
    instructions.push(initTeamHoldingsIx(programId, admin.publicKey, teamId, wallet));
    notes.push("holdings record");
  }

  if (instructions.length === 0) {
    console.log(`${teamId.padEnd(16)} already set up`);
    continue;
  }
  try {
    const signature = await send(connection, instructions, [admin]);
    console.log(`${teamId.padEnd(16)} ${notes.join(", ")}  (${signature})`);
  } catch (error) {
    console.error(`${teamId.padEnd(16)} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}
