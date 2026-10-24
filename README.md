# Oxford vs Cambridge AI Race — on-chain challenges

Two Solana challenges for the AI Race hackathon (King's College, Cambridge · 25 Oct 2026).
Teams solve them on their own laptops against **Solana devnet**; scoring reads the chain.
There is no challenge server.

| Challenge | Difficulty | Tiers | Points |
|---|---|---|---|
| [1 · Operation](challenges/01-operation.md) — decode an account, pay an exact fee with a memo | Intermediate | 30 · 50 · 70 | 150 |
| [2 · Minesweeper](challenges/02-minesweeper.md) — call a booby-trapped program instruction, read and present a code | Advanced | 90 · 80 · 30 | 200 |

Both are open 12:00–14:00. Each tier is scored separately, so partial progress counts.

## How it works

1. **We deploy once:** the `race_registry` program and a CRED token (6 decimals) on devnet.
2. **Teams register:** each team creates a wallet and enters it, with its Challenge ID, on
   Agent Studio.
3. **We seed (~11:50):** `seed-teams.ts` funds every team wallet with SOL and CRED and writes the
   team's own records on chain: a verification record (secret nonce and clearance account) and a
   holdings record (registrar key = team wallet).
4. **Teams solve:** from their laptops, with any language. Their answers are devnet transactions.
5. **Scoring:** the verifier reads devnet and decides which tiers each team passed.
   `scripts/check.ts` is the reference implementation of that logic, and the organisers' fallback.

Only transactions signed by a team's own wallet count for that team.

## Layout

```
program/                 Anchor 1.2.1 program `race_registry`
  programs/race-registry/src/
    lib.rs               instructions: initialize, init_team, init_team_holdings, mint_code
    state.rs             account layouts (byte offsets are published in the briefs)
    instructions/        one file per instruction
scripts/                 organiser tools (Bun + TypeScript)
  setup.ts               one-off: Config, CRED token, presentation account, config.json
  seed-teams.ts          per team: fund wallet, create records (safe to rerun)
  check.ts               reference verifier / scoreboard
  lib.ts                 shared helpers
solutions/               reference solutions (spoilers), used for rehearsal
challenges/              participant briefs
answers/                 worked answers and mentor hints (spoilers)
keys/                    keypairs (git-ignored)
teams.example.csv        format for seed-teams.ts
```

## Get started

See **[DEPLOY.md](DEPLOY.md)** for the step-by-step guide: build, rehearse on a local Surfpool,
deploy to devnet, and run the day.

```bash
bun install
bun run typecheck
```
