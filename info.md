# How the AI Race challenges work

A plain-English overview for organisers. For the commands, see [DEPLOY.md](DEPLOY.md).

## The short version

There are three kinds of activity. Only the first two send transactions, and nobody sends anything by hand.

```
we deploy once  →  teams register wallets  →  we run seed-teams (automatic, per team)
     →  teams solve with their own transactions  →  Agent Studio / check.ts reads the chain → points
```

## 1. Setup — done by us, with scripts

**Once, before the event** (three commands in `DEPLOY.md`):
- deploy the `race_registry` program to devnet;
- run `setup.ts`, which initialises the program's Config (the code freshness window), creates the
  CRED token (6 decimals, we hold the mint authority), creates the presentation account for
  Minesweeper, and writes `config.json` with the values to publish to participants.

**On the day, at about 11:50**, after teams have entered their wallet and Challenge ID on
Agent Studio, export them to a CSV (`challengeId,wallet`) and run:

```bash
bun scripts/seed-teams.ts teams.csv
```

For each team the script sends **one transaction** that:
1. creates the team's CRED token account, mints it 100 CRED and sends it 0.05 SOL for fees;
2. creates the team's **own** clearance token account (owned by its verification record);
3. calls `init_team` — writes the team's verification record with a random secret nonce;
4. calls `init_team_holdings` — writes the team's wallet as `registrar_key`.

40 teams = 40 transactions, sent automatically in about a minute. Rerunning the script skips
anything that already exists, so late teams are added by rerunning it with an updated CSV.

### Why not all 40 teams in one transaction?

Solana caps a transaction at **1,232 bytes**. Measured with this code: one team's setup fits
easily, **two teams take 944 bytes, three take 1,253 bytes** — already over the limit. Each team
brings five new 32-byte addresses (wallet, its token account, clearance account, record, holdings)
plus the instruction data, so the size grows fast. Even with an address lookup table, the
compute budget would cap a transaction at roughly a dozen teams. Batching two teams per
transaction would halve the count (40 → 20), but at about a second per transaction it saves
only seconds, so the script keeps one transaction per team for clearer logs and retries.

## 2. Solving — done by the teams, from their own laptops

Teams use any language. Their "answers" are transactions on devnet, signed by their registered
wallet:

- **Operation (Intermediate, 150 points):** read their verification record, decode the nonce
  and clearance account from raw bytes, then send the exact CRED fee with the right memo in one
  transaction.
- **Minesweeper (Advanced, 200 points):** decode their holdings record, build and send the
  `mint_code` instruction by hand (with the registrar witness and memo traps), read the minted
  code from the chain, then present it with a memo before it goes stale.

Briefs: [`challenges/`](challenges). Answers and mentor hints: [`answers/`](answers).

## 3. Scoring — read-only

When a team presses **Run verification** in Agent Studio, the verifier only **reads** devnet:
did the right transaction happen, and was it signed by that team's wallet? Nothing is sent.

[`scripts/check.ts`](scripts/check.ts) is exactly that logic. Dean can port it into the
Agent Studio plugin, and we can run it ourselves as a live scoreboard or as a fallback:

```bash
bun scripts/check.ts --csv teams.csv
```

| Challenge | Tier 1 | Tier 2 | Tier 3 | Max |
|---|---|---|---|---|
| Operation | 30 — any transfer lands on your clearance account | 50 — exact amount | 70 — exact amount + memo in one transaction | 150 |
| Minesweeper | 90 — your wallet minted a code | 80 — presented within ~30 min | 30 — presented within ~1 min ("fast hands") | 200 |

## What has been tested

Everything was run end to end on a local Surfpool forking devnet:

- full solve scores 350; partial solves score exactly the tiers reached (170, 30);
- `mint_code` rejects a missing registrar (`0x1770`) and a missing or wrong memo (`0x1771`);
- a presentation signed by another team's wallet does not count;
- a presentation after ~75 seconds earns tier 2 but not "fast hands";
- rerunning `seed-teams.ts` is safe.

## Two things that differ from the original design

1. **Builds use `--arch v0`.** Anchor 1.2.1 builds for SBPF v3 by default, and devnet rejects
   that binary (`Detected sbpf_version required by the executable which are not enabled`).
2. **Teams can't sabotage each other in Minesweeper.** `mint_code` is permissionless, so a rival
   could mint over your code just before you present it. The verifier only counts mints signed
   by your own wallet, recomputes every code you minted (from each mint's hash argument and
   slot), and accepts a presentation of any of them. Tested: a rival's overwrite has no effect.

## Things to know

- **Admin wallet:** `keys/admin.json` (`JCVAPp9G7HjpTgyRwNdecHWqz2LzPVLNLkU36PjUJi8Z`). It needs
  about **6 devnet SOL**. The public devnet RPC airdrop is rate-limited and refused requests on
  25 Oct; use https://faucet.solana.com (signing in with GitHub raises the limit) or another
  devnet faucet.
- **Program ID** `6BtrL31HhC3LLZJeqhHWcFHh6w44dwCYE5tpgAbiT4RD` comes from
  `program/target/deploy/race_registry-keypair.json` on the machine that built it. That file is
  not in git. Deploy from that machine, or rebuild elsewhere following `DEPLOY.md` (which
  generates a new ID).
- **Leftover local test files:** `config.json`, `teams.csv` and `keys/test-team*.json` came from
  the Surfpool rehearsal. All are git-ignored. `setup.ts` creates a fresh CRED token when it sees
  a different RPC, so the old `config.json` is harmless, but delete the test files to avoid
  confusion.
- **Anchor version:** installing Anchor 1.2.1 with `avm` also made it the machine's default.
  Projects pinned to an older version need `avm use <version>`.
- **The repository contains the answers.** Keep it private until after the event.
