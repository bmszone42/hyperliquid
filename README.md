# hyperliquid

PAPER-only Hyperliquid harness. Fake **$1000 USDC** equity. Sims-as-live on **real** Hyperliquid books / mids / asks. **LIVE is OFF** — this process never POSTs `/exchange` and there is no ARM LIVE path.

## Mandate

- PAPER only. Starting cash/equity is `$1000` USDC on a local ledger.
- Prices come from the public Hyperliquid info API (`allMids`, `l2Book`). Nothing is invented.
- Simulated fills walk the live ask book (buys) or bid book (sells). A thin book fails closed.
- LIVE OFF. `--live`, `--arm-live`, and `HL_LIVE` / `ARM_LIVE` are rejected.
- No spend, no PAT, no signup.

## Run

```bash
npm test
npm run paper -- --once
```

`--once` fetches live BTC and ETH books, mark-to-markets the ledger, and exercises a **non-committed** sim-fill probe against the live ask (~$10 notional). Equity stays ~1000. Add `--commit-probe` only if you want that probe written onto the paper ledger.

Optional: `--coins BTC,ETH`

Ledger file: `data/ledger.json` (created on first run, gitignored).

## Layout

| Path | Role |
| --- | --- |
| `src/config.mjs` | PAPER constants, LIVE lock, `armLive()` hard-fail |
| `src/info.mjs` | Info API client (`/info` only) |
| `src/ledger.mjs` | $1000 USDC paper ledger + MTM |
| `src/sim.mjs` | Book-walk sim fill |
| `src/paper.mjs` | `npm run paper` cycle |

This repo is the home for the harness. A prior staging PR on `x402-tools` was abandoned and not merged.
