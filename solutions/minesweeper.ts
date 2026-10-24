// Reference solution for Challenge 2 — Minesweeper. SPOILER.
// Organisers use it to rehearse; it is written the way a participant would solve the challenge,
// using only @solana/web3.js and @solana/spl-token (no Anchor client, no IDL).
//
// Usage: bun solutions/minesweeper.ts --team <challengeId> --keypair keys/test-team.json [--no-present] [--wait <seconds>]
//   --no-present   mint only                      -> passes tier 1
//   --wait 90      wait before presenting         -> passes tiers 1-2 but misses "fast hands"
//   (default)      mint, read and present at once -> passes all tiers
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const sha256 = (...parts: (Buffer | string)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};
const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const team = arg("team")!;
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg("keypair", "keys/test-team.json")!, "utf8"))));
const connection = new Connection(config.rpcUrl, "confirmed");
const programId = new PublicKey(config.programId);
const mint = new PublicKey(config.credMint);
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const memoIx = (text: string) => new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });

// Step 1 — find and decode the holdings record (seed uses the team ID exactly, not lowercased).
const [holdings] = PublicKey.findProgramAddressSync([Buffer.from("holdings"), Buffer.from(team)], programId);
const holdingsAccount = await connection.getAccountInfo(holdings);
if (!holdingsAccount) throw new Error(`No holdings record at ${holdings.toBase58()}`);
const registrar = new PublicKey(holdingsAccount.data.subarray(8, 40));
console.log(`holdings ${holdings.toBase58()}\n  registrar_key ${registrar.toBase58()}`);

// Step 2 — build mint_code by hand.
//   data = sha256("global:mint_code")[0..8] ++ borsh(team_id: string) ++ memo_hash (32 bytes)
const memoHash = sha256(Buffer.from(team, "utf8"), Buffer.from(config.salt, "utf8"));
const teamBytes = Buffer.from(team, "utf8");
const teamLength = Buffer.alloc(4);
teamLength.writeUInt32LE(teamBytes.length);
const [clearanceRecord] = PublicKey.findProgramAddressSync([Buffer.from("deed"), Buffer.from(team)], programId);
const mintCode = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: holdings, isSigner: false, isWritable: true },
    { pubkey: clearanceRecord, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: registrar, isSigner: false, isWritable: false }, // the witness: first remaining account
  ],
  data: Buffer.concat([sha256("global:mint_code").subarray(0, 8), teamLength, teamBytes, memoHash]),
});

// Step 3 — send it together with a memo containing hex(memo_hash).
const mintSignature = await sendAndConfirmTransaction(connection, new Transaction().add(memoIx(memoHash.toString("hex")), mintCode), [wallet], {
  commitment: "confirmed",
});
console.log(`minted: ${mintSignature}`);

// Step 4 — read the clearance code from the new record.
//   [8 discriminator][4 length][team bytes][8 clearance_code][8 issued_slot][1 presented]
const record = Buffer.from((await connection.getAccountInfo(clearanceRecord))!.data);
const length = record.readUInt32LE(8);
const code = record.subarray(12 + length, 20 + length).toString("utf8");
const issuedSlot = record.readBigUInt64LE(20 + length);
console.log(`  clearance_code ${code} (issued at slot ${issuedSlot})`);
if (process.argv.includes("--no-present")) process.exit(0);

// Step 5 — present: 1 base unit of CRED to the presentation account, memo "<team>:<code>".
const waitSeconds = Number(arg("wait", "0"));
if (waitSeconds > 0) await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
const source = getAssociatedTokenAddressSync(mint, wallet.publicKey);
const present = new Transaction().add(
  createTransferCheckedInstruction(source, mint, new PublicKey(config.presentationAccount), wallet.publicKey, 1n, 6),
  memoIx(`${team}:${code}`),
);
const presentSignature = await sendAndConfirmTransaction(connection, present, [wallet], { commitment: "confirmed" });
console.log(`presented: ${presentSignature}`);
