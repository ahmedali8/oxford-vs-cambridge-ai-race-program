# Challenge 2 — Minesweeper

**Difficulty:** Advanced · **Points:** 200 (90 + 80 + 30) · **Time guide:** about an hour

## The situation

The race program can mint your team a one-time **clearance code**. The program is booby-trapped:
it only mints if your transaction carries two specific things, and if anything is missing it
refuses without saying which. The code doesn't come back to you either; you have to read it
from the chain. Then you must present it before it goes stale.

## What you have

| | |
|---|---|
| Your Challenge ID | On your Agent Studio team page |
| Your wallet | The one you registered; it holds devnet SOL and CRED |
| RPC URL, program ID, CRED token, salt, presentation account | Published on the challenge page |

No interface description (IDL) is published for the program.

## Step 1 — Find your holdings record

```
holdingsAddress = findProgramAddress(
  ["holdings", utf8(Challenge ID)],       ← exactly as shown, not lowercased
  programId
)

offset  0..8    account discriminator (ignore)
offset  8..40   registrar_key   (32 bytes — the "witness" the program wants to see)
offset  40      codes_minted    (1 byte)
```

## Step 2 — Call `mint_code`

The program is an Anchor program. The instruction is `mint_code(team_id: string, memo_hash: [u8; 32])`:

```
memo_hash = sha256( utf8(Challenge ID) || utf8(salt) )
```

Accounts, in this order:

| # | Account | Signer | Writable |
|---|---|---|---|
| 0 | your wallet (pays) | ✔ | ✔ |
| 1 | your holdings record | | ✔ |
| 2 | your clearance record: `findProgramAddress(["deed", utf8(Challenge ID)], programId)` | | ✔ |
| 3 | instructions sysvar `Sysvar1nstructions1111111111111111111111111` | | |
| 4 | system program `11111111111111111111111111111111` | | |

The two traps:
- the `registrar_key` from step 1 must also be passed, as an **extra account after these five**
  (not a signer);
- the same transaction must contain an **SPL Memo** whose text is `memo_hash` as lowercase hex.

Without an IDL you will have to work out how Anchor encodes the instruction data yourself.

## Step 3 — Read your code

After a successful mint, your clearance record holds the code:

```
offset  0..8    account discriminator (ignore)
then    team             string: 4-byte little-endian length, then the bytes
then    clearance_code   8 bytes (ASCII)
then    issued_slot      unsigned 64-bit integer, little-endian
then    presented        1 byte
```

## Step 4 — Present it

Send **1 base unit of CRED** from your wallet to the published **presentation account**, with an
SPL Memo of:

```
<Challenge ID>:<clearance_code>
```

Do it within the freshness window: about 4,500 slots (roughly 30 minutes) after the code was
minted. Missed it? Mint a fresh code and present that one.

## Tiers

| Tier | Passes when | Points |
|---|---|---|
| 1 · Minted | Your wallet successfully minted a code for your team | 90 |
| 2 · Presented | You presented one of your codes, correctly, within its window | 80 |
| 3 · Fast hands | You presented a code within about 150 slots (~1 minute) of minting it | 30 |

Only codes minted by **your own wallet** count, and only presentations signed by it.
