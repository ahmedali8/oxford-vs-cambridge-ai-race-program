# Challenge 1 — Operation

**Difficulty:** Intermediate · **Points:** 150 (30 + 50 + 70) · **Time guide:** about an hour

## The situation

Your team has a **verification record** on Solana devnet. It holds two things you need: a secret
number called the **clearance nonce**, and the address of your team's **clearance account**.
To clear the challenge, you pay that account an exact fee of CRED tokens, with an exact memo,
in one transaction.

Nobody will tell you the record's format. You get a byte map and nothing else.

## What you have

| | |
|---|---|
| Your Challenge ID | On your Agent Studio team page (for example `T-3f9a21c8`) |
| Your wallet | The one you registered on your team page. It holds devnet SOL for fees and some CRED. |
| RPC URL, program ID, CRED token | Published on the challenge page |

CRED has **6 decimals**. All amounts below are in **base units** (1 CRED = 1,000,000 base units).

## Step 1 — Find your record

Your verification record lives at a program-derived address (PDA):

```
recordAddress = findProgramAddress(
  ["claim", utf8(lowercase(Challenge ID))],
  programId
)
```

Fetch the account's raw data from devnet.

## Step 2 — Decode it

There is no schema. Here is the byte map:

```
offset  0..8    account discriminator (ignore)
offset  8..40   verifier          (32 bytes, a public key)
offset  40      status            (1 byte)
offset  41..49  clearance_nonce   (unsigned 64-bit integer, little-endian)
offset  49..81  clearance_account (32 bytes, a public key — where you pay)
```

## Step 3 — Work out the fee and the memo

```
amount = 1000 + (clearance_nonce mod 9000)          base units of CRED
memo   = first 16 hex characters of
         sha256( utf8(Challenge ID) || clearance_nonce as 8 little-endian bytes )
```

## Step 4 — Pay

Send `amount` CRED from your wallet to `clearance_account`, and put the memo in an **SPL Memo**
instruction (program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) **in the same transaction**.
Sign with your registered wallet.

## Tiers

Press **Run verification** on each tier in Agent Studio. Each tier needs the one before it.

| Tier | Passes when | Points |
|---|---|---|
| 1 · Found it | Any CRED transfer from your wallet lands on your clearance account | 30 |
| 2 · Exact | A transfer of exactly `amount` lands there | 50 |
| 3 · Verified | The exact amount **and** the correct memo are in one transaction | 70 |

The verifier reads the chain. It tells you which tier failed, never what the right value was.
