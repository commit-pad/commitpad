# Commit deployment

## Layout

Keep the shared Pawns source alongside Commit:

```text
/opt/commit/
  releases/RELEASE/
    commit/         # this project, including dist/ and node_modules/
    pawn-solana/    # inspected Pawns source and its locked production dependencies
  current -> releases/RELEASE
/etc/commit.env     # server-only configuration, mode 0600
/var/lib/commit/
  commit.sqlite    # GitHub/project data, encrypted sessions, wallet mappings, audit
  solana/          # inherited Pawns registry, intents, creator-fee ledger, metadata
  uploads/         # content-hashed token images
```

The two source directories are deployed together, but Commit's runtime storage is separate from `/var/lib/pawnspad`. Use **one Commit process per data directory**. The inherited Pawns JSON registry is single-process; SQLite WAL does not make that registry multi-writer safe. For higher throughput, extend the existing Pawns index/storage services before adding replicas.

## Configure

1. Install Node 22.13+ and npm 10.9.4+. Install dependencies from each project's lockfile using `npm ci` (or `npx --yes npm@10.9.4 ci`).
2. In the Commit directory, run `npm run build`, then `npm test` and `npm run test:browser`. Install Chromium via `npx playwright install chromium` if the host lacks it.
3. Create a dedicated `commit` system user with read access to both deployed source directories and write access only to `/var/lib/commit`.
4. Fill `/etc/commit.env` from `.env.example`. Set `COMMIT_DATA_DIR=/var/lib/commit` and `COMMIT_PUBLIC_ORIGIN` to the real HTTPS origin. Protect the file with mode 0600. Generate a random session key; keep it stable across releases.
5. Register the OAuth callback at `https://YOUR-DOMAIN/api/auth/callback`. GitHub OAuth must be registered for the exact deployed origin. The optional GitHub read token and Solana RPC/indexer credentials remain server-only.
6. Adapt `commit.service` and `Caddyfile.example` to your host paths/domain. Put the service behind an HTTPS reverse proxy. Enable loopback proxy trust only with the supplied loopback binding and a proxy that overwrites forwarded headers.
7. Run `npm run check:mainnet` with the deployment RPC to verify the builder's unsigned simulations. Start the service using your host's normal release procedure.

The production entrypoint requires an HTTPS origin and session encryption key. GitHub OAuth credentials are required by default. Explicitly setting `COMMIT_PUBLIC_PREVIEW=1` permits a public deployment before OAuth setup; sign-in and authenticated repository launching remain unavailable.fun`.

## First launch validation

Use a public repository you administer. Sign in, choose it, and connect a funded Solana wallet. New launches are locked to Microsoft xStock (MSFTx), a 2% creator fee, and the designated collection wallet. Optional opening buys need MSFTx; network fees and rent still need SOL. Review the pinned recipient, paired mint, and exact simulated debit before approving. Publication occurs only when the exact signed launch receipt is finalized.

The automated checks do not broadcast a real launch. That final wallet approval is performed by the project owner.

## Backups, upgrades, and recovery

- Back up **all** of `/var/lib/commit`, plus the session encryption key. Images/metadata must remain available at their original URLs for the lifetime of the tokens.
- For consistent backups, stop the service and copy the complete data directory (including SQLite WAL/SHM files if present), then restart. Alternatively use SQLite's online backup facility together with a coordinated snapshot of the Pawns registry, fee ledger, and immutable content.
- Roll back source and assets as a pair while preserving the complete data directory. Never replace the registry with an empty one during a deployment.
- Preserve pending signed bytes. The client and backend retry the same signature; they must not silently generate a second launch.
- Changing `COMMIT_SESSION_KEY` invalidates decryption of existing sessions. Schedule rotation by expiring sessions, replacing the key, and having users sign in again.
- Monitor disk usage, failed refreshes, RPC latency/rate limits, GitHub rate limits, and the inherited fee-history cap. Metadata/upload storage has inherited quotas and a free-space reserve.
- If the GitHub App policy of an organization blocks OAuth access, an organization admin must authorize the OAuth application. The frontend cannot override this server-side access check.

## Operational behavior

Missing/stale upstream values remain unavailable rather than becoming zero. Background indexing processes a bounded project batch per refresh and avoids overlapping full refresh loops. Per-coin payout reservations require fresh, complete fee indexing. Configure `COMMIT_PAYOUT_ADMIN_IDS` with the operator's numeric GitHub ID (`334859250` for commit-pad); the server rejects operator actions by other accounts.

The operator queue is `/admin/payouts`. Approve a request before sending, transfer the exact MSFTx amount manually from the collection wallet in a separate transaction for each request, then record the finalized signature. Approval does not transfer assets. Approved requests stay locked until settlement; pending requests can be rejected or cancelled. Do not restore an older database snapshot that would forget already-paid receipts. Keep the SQLite payout records and audit log in every coordinated backup.
