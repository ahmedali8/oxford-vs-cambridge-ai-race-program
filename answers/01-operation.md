# Answer — Challenge 1, Operation

**Spoilers. Organisers and mentors only.** Runnable version: [`solutions/operation.ts`](../solutions/operation.ts).

## Solution

```ts
import { createHash } from "node:crypto";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

// 1. Find the record — the seed uses the Challenge ID in LOWERCASE.
const [record] = PublicKey.findProgramAddressSync(
  [Buffer.from("claim"), Buffer.from(teamId.toLowerCase())],
  programId,
);
const data = Buffer.from((await connection.getAccountInfo(record))!.data);

// 2. Decode.
const nonce = data.readBigUInt64LE(41);                  // u64, little-endian
const clearanceAccount = new PublicKey(data.subarray(49, 81));

// 3. Fee and memo.
const amount = 1000n + (nonce % 9000n);
const nonceBytes = Buffer.alloc(8);
nonceBytes.writeBigUInt64LE(nonce);
const memo = createHash("sha256")
  .update(Buffer.from(teamId, "utf8"))                    // the ID exactly as shown, NOT lowercased
  .update(nonceBytes)                                     // raw 8 bytes, not a string
  .digest("hex")
  .slice(0, 16);

// 4. One transaction: transfer + memo.
const source = getAssociatedTokenAddressSync(credMint, wallet.publicKey);
const tx = new Transaction().add(
  createTransferCheckedInstruction(source, credMint, clearanceAccount, wallet.publicKey, amount, 6),
  new TransactionInstruction({
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys: [],
    data: Buffer.from(memo, "utf8"),
  }),
);
await sendAndConfirmTransaction(connection, tx, [wallet]);
```

## How each tier is checked

The verifier (`scripts/check.ts → checkOperation`) reads the team's record and holdings from
chain, then every transaction that touched the clearance account:

| Tier | Condition |
|---|---|
| 1 | A successful `transfer`/`transferChecked` **to** the clearance account, **authorised by** the team wallet (the wallet is stored as `registrar_key` in the team's holdings record) |
| 2 | Same, with amount exactly `1000 + nonce mod 9000` |
| 3 | Same transaction also contains an SPL Memo equal to the expected 16 hex characters |

Each team's clearance account is a token account owned by **its own** verification record, so
no two teams share a destination.

## Where people get stuck (mentor hints, in order)

1. **Wrong address.** The PDA seed is the ID in lowercase; everywhere else the ID is used as shown.
2. **Nonce read as big-endian or as text.** It's bytes 41–49, little-endian, unsigned.
   `readBigUInt64LE(41)` in JavaScript; `int.from_bytes(data[41:49], "little")` in Python.
3. **Paying in CRED rather than base units.** The amount is base units: 4446 means 0.004446 CRED.
4. **Memo built from the nonce as a string.** Hash the 8 raw little-endian bytes.
5. **Memo sent in a second transaction.** Transfer and memo must be in the **same** transaction.
6. **Paying from another wallet.** Only transfers signed by the registered team wallet count.
