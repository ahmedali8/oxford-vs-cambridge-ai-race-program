// One-off organiser setup, run after the program is deployed:
//   1. initialise the program's Config (code freshness window),
//   2. create the CRED token (6 decimals, admin is mint authority),
//   3. create the presentation account for Minesweeper,
//   4. write config.json with everything participants need.
// Safe to rerun: existing pieces are reused.
//
// Usage: bun scripts/setup.ts --rpc <url> [--keypair keys/admin.json] [--window 4500]
import { randomBytes } from "node:crypto";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  arg,
  configPda,
  connect,
  CRED_DECIMALS,
  decodeConfig,
  fail,
  initializeIx,
  loadKeypair,
  PROGRAM_KEYPAIR_PATH,
  readConfigIfPresent,
  saveConfig,
  send,
  type RaceConfig,
} from "./lib.ts";

const rpcUrl = arg("rpc", process.env.RPC_URL ?? "http://127.0.0.1:8899")!;
const admin = loadKeypair(arg("keypair", "keys/admin.json")!);
const window = BigInt(arg("window", "4500")!);
const connection = connect(rpcUrl);
const programId = loadKeypair(PROGRAM_KEYPAIR_PATH).publicKey;

const program = await connection.getAccountInfo(programId);
if (!program?.executable) fail(`Program ${programId.toBase58()} is not deployed on ${rpcUrl}. Deploy it first (see DEPLOY.md).`);

// 1. Config
const config = configPda(programId);
const existingConfig = await connection.getAccountInfo(config);
if (existingConfig) {
  console.log(`Config already initialised (window ${decodeConfig(existingConfig.data).codeWindowSlots} slots)`);
} else {
  await send(connection, [initializeIx(programId, admin.publicKey, window)], [admin]);
  console.log(`Config initialised (window ${window} slots)`);
}

// 2. CRED token — reuse the one in config.json if it still exists on this network.
const previous = readConfigIfPresent();
let credMint: PublicKey | null = null;
if (previous && previous.rpcUrl === rpcUrl && previous.programId === programId.toBase58()) {
  const candidate = new PublicKey(previous.credMint);
  if (await connection.getAccountInfo(candidate)) credMint = candidate;
}
if (credMint) {
  console.log(`CRED token reused: ${credMint.toBase58()}`);
} else {
  credMint = await createMint(connection, admin, admin.publicKey, null, CRED_DECIMALS);
  console.log(`CRED token created: ${credMint.toBase58()}`);
}

// 3. Presentation account: the admin's CRED token account.
const presentation = await getOrCreateAssociatedTokenAccount(connection, admin, credMint, admin.publicKey);

// 4. config.json
const configured = decodeConfig((await connection.getAccountInfo(config))!.data);
const result: RaceConfig = {
  rpcUrl,
  programId: programId.toBase58(),
  credMint: credMint.toBase58(),
  presentationAccount: presentation.address.toBase58(),
  salt: previous?.salt ?? randomBytes(4).toString("hex"),
  codeWindowSlots: Number(configured.codeWindowSlots),
};
saveConfig(result);
console.log("\nconfig.json written. Publish these values to participants:\n");
console.log(JSON.stringify(result, null, 2));
