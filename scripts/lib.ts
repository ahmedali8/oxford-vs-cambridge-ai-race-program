// Shared helpers for the organiser scripts: config, keypairs, PDAs, instruction encoding and
// account decoding. Instructions are encoded by hand (Anchor discriminator + Borsh arguments),
// so no Anchor client or IDL is needed.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type ParsedTransactionWithMeta,
  type Signer,
} from "@solana/web3.js";

export const ROOT = join(import.meta.dir, "..");
export const CONFIG_PATH = join(ROOT, "config.json");
export const PROGRAM_KEYPAIR_PATH = join(ROOT, "program/target/deploy/race_registry-keypair.json");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const CRED_DECIMALS = 6;
export const TEAM_ID_PATTERN = /^[A-Za-z0-9-]{1,16}$/;

/** Everything participants need, written by `setup.ts` and published on the challenge pages. */
export interface RaceConfig {
  rpcUrl: string;
  programId: string;
  credMint: string;
  presentationAccount: string;
  salt: string;
  codeWindowSlots: number;
}

// ---------------------------------------------------------------- arguments, config, keys

/** Reads `--name value` from the command line. */
export function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

export function requireArg(name: string): string {
  const value = arg(name);
  if (!value) fail(`Missing --${name}`);
  return value;
}

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function loadConfig(): RaceConfig {
  if (!existsSync(CONFIG_PATH)) fail(`No config.json yet. Run "bun scripts/setup.ts" first.`);
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RaceConfig;
}

export function readConfigIfPresent(): RaceConfig | null {
  return existsSync(CONFIG_PATH) ? (JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RaceConfig) : null;
}

export function saveConfig(config: RaceConfig): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function loadKeypair(path: string): Keypair {
  const resolved = path.startsWith("/") ? path : join(ROOT, path);
  if (!existsSync(resolved)) fail(`Keypair not found: ${resolved}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, "utf8")) as number[]));
}

export function connect(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

export async function send(connection: Connection, instructions: TransactionInstruction[], signers: Signer[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: "confirmed" });
}

// ---------------------------------------------------------------- hashing and encoding

export function sha256(...parts: (Buffer | Uint8Array | string)[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

/** Borsh string: 4-byte little-endian length, then UTF-8 bytes. */
export function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
export function discriminator(name: string): Buffer {
  return sha256(`global:${name}`).subarray(0, 8);
}

export function randomNonce(): bigint {
  return randomBytes(8).readBigUInt64LE(0);
}

export function memoInstruction(text: string): TransactionInstruction {
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });
}

// ---------------------------------------------------------------- program addresses

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

/** Verification record. The seed lowercases the team ID. */
export function recordPda(programId: PublicKey, teamId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("claim"), Buffer.from(teamId.toLowerCase())], programId)[0];
}

export function holdingsPda(programId: PublicKey, teamId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("holdings"), Buffer.from(teamId)], programId)[0];
}

export function clearancePda(programId: PublicKey, teamId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("deed"), Buffer.from(teamId)], programId)[0];
}

// ---------------------------------------------------------------- admin instructions

export function initializeIx(programId: PublicKey, authority: PublicKey, codeWindowSlots: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("initialize"), u64le(codeWindowSlots)]),
  });
}

export function initTeamIx(programId: PublicKey, authority: PublicKey, teamId: string, nonce: bigint, clearanceAta: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: recordPda(programId, teamId), isSigner: false, isWritable: true },
      { pubkey: clearanceAta, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("init_team"), borshString(teamId), u64le(nonce)]),
  });
}

export function initTeamHoldingsIx(programId: PublicKey, authority: PublicKey, teamId: string, registrar: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: holdingsPda(programId, teamId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("init_team_holdings"), borshString(teamId), registrar.toBuffer()]),
  });
}

// ---------------------------------------------------------------- account decoding

export function decodeConfig(data: Buffer) {
  return { authority: new PublicKey(data.subarray(8, 40)), codeWindowSlots: data.readBigUInt64LE(40) };
}

export function decodeVerificationRecord(data: Buffer) {
  return {
    verifier: new PublicKey(data.subarray(8, 40)),
    status: data[40],
    clearanceNonce: data.readBigUInt64LE(41),
    clearanceAta: new PublicKey(data.subarray(49, 81)),
  };
}

export function decodeHoldings(data: Buffer) {
  return { registrarKey: new PublicKey(data.subarray(8, 40)), codesMinted: data[40] };
}

export function decodeClearanceRecord(data: Buffer) {
  const length = data.readUInt32LE(8);
  const end = 12 + length;
  return {
    team: data.subarray(12, end).toString("utf8"),
    clearanceCode: data.subarray(end, end + 8).toString("utf8"),
    issuedSlot: data.readBigUInt64LE(end + 8),
    presented: data[end + 16] === 1,
  };
}

// ---------------------------------------------------------------- parsed transactions

export interface TokenTransfer {
  destination: string;
  authority: string | null;
  amount: bigint;
}

type ParsedLike = { program?: string; programId?: PublicKey; parsed?: unknown };

function allInstructions(tx: ParsedTransactionWithMeta): ParsedLike[] {
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions);
  return [...tx.transaction.message.instructions, ...inner] as ParsedLike[];
}

/** Every SPL token transfer / transferChecked in the transaction, including inner instructions. */
export function tokenTransfers(tx: ParsedTransactionWithMeta): TokenTransfer[] {
  const out: TokenTransfer[] = [];
  for (const ix of allInstructions(tx)) {
    const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> } | undefined;
    if (ix.program !== "spl-token" || !parsed?.info) continue;
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") continue;
    const info = parsed.info;
    const raw = (info.tokenAmount as { amount?: string } | undefined)?.amount ?? info.amount;
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    out.push({
      destination: String(info.destination),
      authority: typeof info.authority === "string" ? info.authority : typeof info.multisigAuthority === "string" ? info.multisigAuthority : null,
      amount: BigInt(raw),
    });
  }
  return out;
}

/** Text of every SPL Memo in the transaction. */
export function memos(tx: ParsedTransactionWithMeta): string[] {
  return allInstructions(tx)
    .filter((ix) => ix.program === "spl-memo" && typeof ix.parsed === "string")
    .map((ix) => ix.parsed as string);
}

export function signers(tx: ParsedTransactionWithMeta): string[] {
  return tx.transaction.message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey.toBase58());
}
