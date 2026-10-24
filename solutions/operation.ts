// Reference solution for Challenge 1 — Operation. SPOILER.
// Organisers use it to rehearse; it is written the way a participant would solve the challenge,
// using only @solana/web3.js and @solana/spl-token.
//
// Usage: bun solutions/operation.ts --team <challengeId> --keypair keys/test-team.json [--tier 1|2|3]
//   --tier 1  sends 1 base unit (no memo)        -> passes tier 1 only
//   --tier 2  sends the exact amount (no memo)   -> passes tiers 1-2
//   --tier 3  exact amount + memo (default)      -> passes all tiers
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const team = arg("team")!;
const tier = Number(arg("tier", "3"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg("keypair", "keys/test-team.json")!, "utf8"))));
const connection = new Connection(config.rpcUrl, "confirmed");
const programId = new PublicKey(config.programId);
const mint = new PublicKey(config.credMint);
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Step 1 — find the verification record. The seed uses the team ID in lowercase.
const [recordAddress] = PublicKey.findProgramAddressSync([Buffer.from("claim"), Buffer.from(team.toLowerCase())], programId);
const account = await connection.getAccountInfo(recordAddress);
if (!account) throw new Error(`No verification record at ${recordAddress.toBase58()}`);

// Step 2 — decode it from the byte map: nonce at 41..49 (u64 little-endian), destination at 49..81.
const data = Buffer.from(account.data);
const nonce = data.readBigUInt64LE(41);
const clearanceAccount = new PublicKey(data.subarray(49, 81));
console.log(`record ${recordAddress.toBase58()}\n  nonce ${nonce}\n  clearance account ${clearanceAccount.toBase58()}`);

// Step 3 — compute the fee and the memo.
const amount = 1000n + (nonce % 9000n);
const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(nonce);
const memo = createHash("sha256").update(Buffer.from(team, "utf8")).update(nonceBytes).digest("hex").slice(0, 16);
console.log(`  amount ${amount} base units\n  memo ${memo}`);

// Step 4 — one transaction: the CRED transfer and the memo together.
const source = getAssociatedTokenAddressSync(mint, wallet.publicKey);
const tx = new Transaction().add(createTransferCheckedInstruction(source, mint, clearanceAccount, wallet.publicKey, tier === 1 ? 1n : amount, 6));
if (tier >= 3) tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(memo, "utf8") }));
const signature = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: "confirmed" });
console.log(`sent (tier ${tier}): ${signature}`);
