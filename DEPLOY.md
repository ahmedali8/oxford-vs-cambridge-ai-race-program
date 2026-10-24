# Deployment guide

Three parts: **build** the program once, **rehearse** on a local Surfpool, then **deploy to devnet**
for the event. Commands run from the repository root unless stated.

## 0. Install the tools (once)

| Tool | Version | Install |
|---|---|---|
| Solana CLI (Agave) | 3.x | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Rust | via rustup | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Anchor | **1.2.1** | `cargo install --git https://github.com/solana-foundation/anchor avm --force` then `avm install 1.2.1 && avm use 1.2.1` |
| Bun | 1.x | `curl -fsSL https://bun.sh/install \| bash` |
| Surfpool | 1.6+ | `curl -sL https://run.surfpool.run/ \| bash` |

Then install the script dependencies:

```bash
bun install
```

## 1. Build the program (once)

```bash
cd program
anchor build --arch v0      # first build creates target/deploy/race_registry-keypair.json
anchor keys sync            # writes that keypair's address into declare_id! and Anchor.toml
anchor build --arch v0      # rebuild with the right program ID
cd ..
```

`--arch v0` matters: Anchor 1.2.1 builds for SBPF v3 by default, which devnet doesn't accept yet
(`Detected sbpf_version required by the executable which are not enabled`).

Keep `program/target/deploy/race_registry-keypair.json` safe: it is the program's address.

## 2. Rehearse locally on Surfpool

**Terminal 1** — a local chain that forks devnet (so the SPL Token and Memo programs exist):

```bash
surfpool start --no-tui --network devnet
```

**Terminal 2:**

```bash
RPC=http://127.0.0.1:8899

# Organiser wallet, funded by Surfpool
solana-keygen new --no-bip39-passphrase -o keys/admin.json
solana airdrop 100 $(solana-keygen pubkey keys/admin.json) --url $RPC

# Deploy and set up (Config, CRED token, presentation account, config.json)
solana program deploy program/target/deploy/race_registry.so \
  --program-id program/target/deploy/race_registry-keypair.json \
  --keypair keys/admin.json --url $RPC
bun scripts/setup.ts --rpc $RPC

# A test team
solana-keygen new --no-bip39-passphrase -o keys/test-team.json
printf "challengeId,wallet\nT-test01,%s\n" $(solana-keygen pubkey keys/test-team.json) > teams.csv
bun scripts/seed-teams.ts teams.csv

# Solve both challenges as that team, then check the score
bun solutions/operation.ts   --team T-test01 --keypair keys/test-team.json
bun solutions/minesweeper.ts --team T-test01 --keypair keys/test-team.json
bun scripts/check.ts --csv teams.csv
```

Expected:

```
team              operation 1 2 3   minesweeper 1 2 3   points  notes
T-test01                    ✔ ✔ ✔               ✔ ✔ ✔      350
```

Partial runs, to see tiers fail as they should:
`--tier 1` or `--tier 2` on `operation.ts`; `--no-present` or `--wait 90` on `minesweeper.ts`.

Stop Surfpool with Ctrl-C when done. Then delete `keys/admin.json`, `keys/test-team.json`,
`teams.csv` and `config.json` before the real deployment.

## 3. Deploy to devnet (the event)

### The night before

```bash
# A devnet RPC that won't rate-limit (e.g. a free Helius devnet URL)
RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY

# Fresh organiser wallet
solana-keygen new --no-bip39-passphrase -o keys/admin.json
solana-keygen pubkey keys/admin.json
```

Fund that address with about **6 devnet SOL** from https://faucet.solana.com (several requests
may be needed; start early). Rough budget:

| | SOL |
|---|---|
| Program deploy (about half is refunded when the deploy buffer closes) | ~3.2 |
| Per team: 0.05 to the team + account rent ≈ 0.06 × 40 teams | ~2.4 |
| Fees | small |

```bash
solana program deploy program/target/deploy/race_registry.so \
  --program-id program/target/deploy/race_registry-keypair.json \
  --keypair keys/admin.json --url $RPC

bun scripts/setup.ts --rpc $RPC
```

`setup.ts` prints `config.json`. **Publish these values** on both challenge pages in Agent Studio:
`rpcUrl` (or tell teams to use their own devnet RPC), `programId`, `credMint`,
`presentationAccount` and `salt`.

Rehearse once on devnet with a test team (same commands as in part 2, without the airdrop).

### On the day

1. **11:40–11:50** — teams create a wallet and enter it with their Challenge ID on Agent Studio.
2. **~11:50** — export them as `teams.csv`:

   ```
   challengeId,wallet
   T-3f9a21c8,7xKX...
   T-0b77de10,9aQp...
   ```

   ```bash
   bun scripts/seed-teams.ts teams.csv
   ```

   Rerun it any time with an updated CSV; teams already set up are skipped, so late teams just
   get added.
3. **12:00–14:00** — challenges open. Agent Studio scores the tiers. To see everything yourself
   (or as a fallback if the platform has a problem):

   ```bash
   bun scripts/check.ts --csv teams.csv
   ```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Detected sbpf_version required by the executable which are not enabled` | Rebuild with `anchor build --arch v0` |
| `Program … is not deployed` from `setup.ts` | Deploy first, against the same `--rpc` |
| `team not set up on chain` in `check.ts` | The team isn't in `teams.csv`, or seeding failed for it; rerun `seed-teams.ts` |
| Surfpool: `Failed to fetch accounts from remote` | Temporary network blip while Surfpool reads devnet; retry |
| Faucet refuses | Rate limit; try later, use another faucet, or ask in the Solana developer channels |
| A team's `mint_code` fails with `0x1770` / `0x1771` | Working as intended: registrar missing / memo missing (see `answers/02-minesweeper.md`) |
