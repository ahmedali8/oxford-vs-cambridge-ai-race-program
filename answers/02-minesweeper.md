# Answer — Challenge 2, Minesweeper

**Spoilers. Organisers and mentors only.** Runnable version: [`solutions/minesweeper.ts`](../solutions/minesweeper.ts).

## Solution

```ts
import { createHash } from "node:crypto";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const sha256 = (...parts: (Buffer | string)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const memoIx = (text: string) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text) });

// 1. Holdings record — seed uses the ID exactly as shown.
const [holdings] = PublicKey.findProgramAddressSync([Buffer.from("holdings"), Buffer.from(teamId)], programId);
const registrar = new PublicKey((await connection.getAccountInfo(holdings))!.data.subarray(8, 40));

// 2. Instruction data, Anchor-style:
//    discriminator = sha256("global:mint_code")[0..8]
//    team_id       = Borsh string: u32 little-endian length + UTF-8 bytes
//    memo_hash     = 32 raw bytes
const memoHash = sha256(Buffer.from(teamId), Buffer.from(salt));
const id = Buffer.from(teamId);
const len = Buffer.alloc(4);
len.writeUInt32LE(id.length);
const data = Buffer.concat([sha256("global:mint_code").subarray(0, 8), len, id, memoHash]);

const [clearanceRecord] = PublicKey.findProgramAddressSync([Buffer.from("deed"), Buffer.from(teamId)], programId);
const mintCode = new TransactionInstruction({
  programId,
  data,
  keys: [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: holdings, isSigner: false, isWritable: true },
    { pubkey: clearanceRecord, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: registrar, isSigner: false, isWritable: false },     // trap 1: the witness
  ],
});

// 3. Memo (trap 2) + mint in one transaction.
await sendAndConfirmTransaction(connection, new Transaction().add(memoIx(memoHash.toString("hex")), mintCode), [wallet]);

// 4. Read the code: [8 disc][4 len][team][8 code][8 slot][1 presented]
const record = Buffer.from((await connection.getAccountInfo(clearanceRecord))!.data);
const n = record.readUInt32LE(8);
const code = record.subarray(12 + n, 20 + n).toString("utf8");

// 5. Present: 1 base unit to the presentation account + memo "<id>:<code>".
const source = getAssociatedTokenAddressSync(credMint, wallet.publicKey);
await sendAndConfirmTransaction(connection, new Transaction().add(
  createTransferCheckedInstruction(source, credMint, presentationAccount, wallet.publicKey, 1n, 6),
  memoIx(`${teamId}:${code}`),
), [wallet]);
```

Running steps 2–5 in one script, with no pause, is what earns **Fast hands** (tier 3).

## What the program does

`mint_code` (in `program/programs/race-registry/src/instructions/mint_code.rs`):

1. Fails with `RegistrarMissing` (error `0x1770`) unless the first extra account equals
   `holdings.registrar_key`. It does not need to sign.
2. Fails with `MemoMissing` (error `0x1771`) unless some instruction in the transaction is an SPL
   Memo whose data is exactly the 64-character lowercase hex of `memo_hash`. It checks this by
   reading the instructions sysvar.
3. Writes `clearance_code = first 8 characters of base58(sha256(team_id ‖ memo_hash ‖ slot as u64 LE))`
   and the current slot as `issued_slot`.

The program only checks that the memo matches `memo_hash`; it does not check that `memo_hash` was
built from the salt. Any 32 bytes work, as long as the memo matches.

## How each tier is checked

The verifier (`scripts/check.ts → checkMinesweeper`):

| Tier | Condition |
|---|---|
| 1 | A successful `mint_code` for this team **signed by the team wallet** |
| 2 | A successful transaction **signed by the team wallet**, touching the presentation account, with the memo `<id>:<code>`, where `<code>` is one the team's own wallet minted, and the presentation is within `code_window_slots` (4500) after that mint |
| 3 | Same, within 150 slots |

`mint_code` is permissionless, so another team could mint a code for you and overwrite your
record. The verifier therefore recomputes every code the team's own wallet minted (from each
mint's `memo_hash` argument and slot) and accepts a presentation of any of them. Overwriting
someone else's code achieves nothing.

## Where people get stuck (mentor hints, in order)

1. **Holdings address wrong.** This seed uses the ID as shown; Operation's record used lowercase.
2. **Instruction data.** The first 8 bytes are `sha256("global:mint_code")[0..8]`; the string is
   length-prefixed (4 bytes, little-endian).
3. **Registrar in the wrong place.** It goes after the five named accounts, not instead of one.
4. **Memo text.** Lowercase hex of the 32-byte hash (64 characters), not base58 and not the raw bytes.
5. **Reading the code.** The team string has a 4-byte length prefix before it, so the code's
   offset depends on the length of the ID.
6. **Stale code.** More than ~30 minutes between mint and presentation: mint again.
