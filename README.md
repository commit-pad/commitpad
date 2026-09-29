# commit.

**Fund the code.** Commit is a launchpad for open-source repositories: https://commitpad.fun

[![Backed on Commit](https://commitpad.fun/badge/commit-pad/commitpad.svg)](https://commitpad.fun/commit-pad/commitpad)

## What it does

- **Launch a coin for any public GitHub repository.** You can launch your own, or back someone else's. Coins launch through Pump.fun on Solana, and your own wallet signs every transaction.
- **Creator fees go to the people building it.** A repository's maintainers, plus the contributors they approve, claim its fees. The fees are verified with GitHub, not assigned to whoever launched the coin.
- **Community launches are labelled.** A coin launched by someone who doesn't maintain the repository says so, together with the launcher's GitHub username.
- **Code and market side by side.** Each coin page shows merged pull requests, releases, and contributors next to the market.

## How it works

1. **Repository:** sign in with GitHub and choose any public repository.
2. **Token:** set the name, ticker, and image.
3. **Treasury:** new coins are paired with Microsoft xStock (MSFTx) at a 2% creator fee, and each coin gets its own treasury ledger.
4. **Build:** maintainers request payouts at [commitpad.fun/payouts](https://commitpad.fun/payouts) and approve contributors.

## Code

This repository is the Commit web app and API: a React + Vite frontend, a Node 22 server (`node:sqlite`), and tests.

| Path | What's there |
|---|---|
| `src/` | Pages: launch flow, coin pages, payouts, explore, legal, operator tools |
| `server/` | HTTP API, static serving with per-page link previews |
| `lib/` | GitHub auth and permissions, launch policy, payout ledger, reports, badges |
| `packages/pump-core/` | Thin bridge to the Pawns launch engine (Pump.fun transactions, wallet signing) |
| `tests/` | Vitest unit/API tests and Playwright browser tests |
| `deploy/` | systemd units, Caddy example, daily backup script |
| `docs/ARCHITECTURE.md` | Full technical write-up: launch flow, storage, funding rules, verification |

Commit builds on the Pawns launch engine, which is checked out as a sibling directory `../pawn-solana` and isn't included here, so this repository doesn't build on its own. Configuration comes from `.env.example`; real credentials are never committed.

## Links

- Site: https://commitpad.fun
- X: [@commitpadfun](https://x.com/commitpadfun)
- Unclaimed fees: https://commitpad.fun/unclaimed
- Report a coin: https://commitpad.fun/report
- Terms and risks: https://commitpad.fun/terms · https://commitpad.fun/risk

Coins are speculative and can lose all value. Nothing here is investment advice.
