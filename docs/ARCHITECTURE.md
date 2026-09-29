# Commit

**Fund the code.** A GitHub-native launchpad using the existing Pawns Pump.fun implementation.

Commit's source-linked protocol dependency is the Pawns launch engine, checked out as a sibling directory `../pawn-solana` (not included in this repository). Both directories are required to build. There is no second Pump.fun transaction builder in Commit.

## Run

Use Node **22.13+** (verified with 22.22.1) and npm **10.9.4+** for dependency installation.

```sh
# Run in this directory
npx --yes npm@10.9.4 ci
npm run dev
```

Development runs at `http://localhost:5190`. Without configuration, the UI, empty discovery, and wallet connection work; GitHub sign-in explicitly reports that deployment configuration is required. No synthetic projects, trading numbers, or successful launches are added to the production app.

For real GitHub authentication and token metadata, configure an HTTPS origin. GitHub session cookies are Secure, and Pawns publishes immutable metadata at that origin. Put a local HTTPS proxy/tunnel in front of the dev server or deploy the production server. Keep the same public origin for the complete flow.

## Production setup

1. Deploy `commit/` and the inspected `pawn-solana/` as sibling directories, each with dependencies installed from its lockfile. See [deployment instructions](deploy/README.md).
2. Create a **GitHub OAuth App**. Set its homepage to your Commit HTTPS origin and its authorization callback to `https://YOUR-DOMAIN/api/auth/callback`.
3. Copy `.env.example` to `.env.local` and configure the origin, data directory, OAuth client ID/secret, and 32-byte session encryption key. An authenticated production RPC is recommended for sustained traffic.
4. Configure `SOLANA_INDEXER_URL` if holder counts are required. This must implement DAS `getTokenAccounts` with cursor pagination. `GITHUB_READ_TOKEN` is optional for background public GitHub updates; authenticated user requests already use their OAuth token.
5. Build, verify, and start behind HTTPS:

```sh
npm run build
npm test
npm run test:browser
npm run check:mainnet
npm start
```

`check:mainnet` uses public onchain addresses for **unsigned simulations only**. It has no wallet private keys and never broadcasts. A real production launch requires the repository administrator to authenticate and approve the transaction in their own funded wallet.

Production startup requires the HTTPS origin and encryption key, plus GitHub credentials by default. An explicit `COMMIT_PUBLIC_PREVIEW=1` permits serving the public site before OAuth configuration; authentication and repository launching stay unavailable. Server secrets are not included in this project.fun`.

## Implemented flow

```text
GitHub OAuth + PKCE
  → any active public repository (owner/name or URL), or one from the user's own list
  → server-side check: public + active; admin/maintain permission decides maintainer vs community launch
  → repository-bound metadata + token image
  → pinned Microsoft xStock pair + fixed 2% collector + per-coin treasury ledger
  → Solana Wallet Standard connection
  → existing Pawns buildLaunch + unsigned simulation
  → exact cost and recipient review
  → wallet signature + browser mint signature
  → Pawns wallet-message validation, submission, and recovery
  → exact finalized receipt verification
  → GitHub repository ID ↔ mint publication
  → /owner/repository
```

Any signed-in GitHub user can launch any active, **public** repository, one coin per repository. If the launcher has GitHub `admin` or `maintain` permission it is a **maintainer launch**; otherwise it is a **community launch**, labelled on the coin page and cards with the launcher's GitHub username and a statement that the maintainers did not create or endorse it. Launch type and launcher are also written into the token metadata (`commitLaunch`). Launching gives no powers: fee claims, contributor approval, and project settings always re-check live GitHub `admin`/`maintain` permission, so a community coin's fees can only be claimed by that repository's maintainers and the contributors they approve. A user can hold at most 3 open launch reservations at a time. Private repository contents are not exposed. OAuth uses `read:user public_repo read:org`; GitHub's classic OAuth public-repository scope is broad, but Commit only performs read requests to GitHub. Organizations may require third-party OAuth approval or SSO authorization. OAuth was chosen to support personal and organization repositories without requiring a GitHub App installation for every owner.

## Pages

| Route | Function |
|---|---|
| `/` | Narrative homepage, real finalized project discovery |
| `/explore` | Repository/ticker/mint search, categories, stars/contributors/activity/market/revenue filters |
| `/create` | Five-step repository launch, review, wallet signing, recovery |
| `/[owner]/[repo]` | GitHub profile, market metrics, shared Pawns chart and buy/sell, orders, development activity |
| `/dashboard` | Repositories the current user can manage |
| `/dashboard/[owner]/[repo]` | Overview, market, treasury, contributors, repository, revenue, settings |
| `/payouts` | Connect GitHub, see every coin tied to repositories you maintain (whoever launched it) or where you are an approved contributor, and request payouts in one place |
| `/unclaimed` | Community-launched coins whose maintainers have not connected yet |
| `/terms`, `/privacy`, `/risk` | Plain-language terms, privacy, and risk disclosure (have them reviewed by a lawyer) |
| `/report` | Anyone can report a coin (impersonation, trademark, copyright, scam); reports appear to the operator at `/admin/payouts#reports`, where a coin can be delisted |
| `/badge/[owner]/[repo].svg` | README badge (`commit. \| $TICKER`, or "launch on commit") |
| `/account` | Verified GitHub identity and signature-proven Solana wallet mapping |
| `/admin/payouts` | Operator-only queue for reviewing requests and verifying manually sent payouts |

## Pawns reuse map

`packages/pump-core` is a source-linked internal facade, not a copied SDK implementation. It imports the inspected sibling Pawns source directly.

| Existing Pawns module | Used by Commit |
|---|---|
| `server/pump.ts` | Official Pump SDK create_v2, mint/owner checks, exact amounts, lookup tables, simulation, receipt signature checking |
| `server/solana.ts` | Metadata, launch preparation, signed submission, finality, saved plans, market and trade API |
| `src/solana/wallet.ts` | Wallet Standard discovery, connection, wallet-change handling, signing |
| `src/solana/client.ts` | Browser mint signing, exact message checking, signature validation, bounded local recovery |
| `server/images.ts`, `contentStore.ts` | Content-hashed image and metadata persistence |
| `server/trading.ts`, `walletReview.ts` | Curve/PumpSwap quotes, canonical pools, trading and Phantom safety validation |
| `src/solana/TradePanel.tsx`, `MarketChart.tsx`, `Review.tsx` | Actual buy/sell, chart, and launch review components |
| `server/coinFees.ts`, `usdPrice.ts` | Finalized per-token creator-fee history and USD references |
| `server/fees.ts` | Read-only treasury wallet and creator-vault balances |
| `server/httpSecurity.ts` | Origin enforcement, bounded bodies, rate limiting, security headers |

### Narrow changes to shared Pawns source

- `server/pump.ts`: optional **server-supplied** creator recipient and required creator-fee basis points; defaults remain the fixed Pawns recipient and its existing fee schedule. Simulated curve identity must match the recipient, paired mint, and exact fee.
- `server/pairs.ts`: parameterized server fee requirement for integrations; the default custom-pair requirement remains 3% for Pawns. Commit explicitly supplies 200 basis points.
- `server/solana.ts`: optional metadata/authorization/prepared/submission integration hooks; read methods for finalized launches and fee statistics. Without the hooks, the original Pawns API policy applies. Raw requests to the original API cannot select a different treasury.
- `server/fees.ts`: optional recipient for read-only fee balances. Existing fee claims and the default Pawns recipient remain unchanged.
- `src/solana/client.ts`: exports its existing Keypair type/constructor for consumers of the shared mint-signing helpers.

Commit uses **independent** protocol registry, fee ledger, metadata, uploads, and SQLite storage. Do not configure its data directory inside Pawns' production data directory. The existing Pawns service was not restarted or redeployed as part of this build.

## Storage and authorization

`COMMIT_DATA_DIR/commit.sqlite` uses SQLite WAL with unique repository ID, repository slug, and mint constraints. Tables hold encrypted GitHub sessions, one-time OAuth state/PKCE verifiers, repository launch reservations, finalized project mappings, verified contributor wallets, eligibility decisions, allocation settings, audit records, bounded metric observations, and per-coin payout requests. Payout amounts are integer strings, not floating-point balances; reservations and transitions use SQLite transactions.

GitHub access tokens are AES-256-GCM encrypted; session identifiers are random and stored only as hashes. Sessions expire after eight hours. OAuth state is single-use and browser-bound. Mutation endpoints enforce same-origin JSON requests. Repository permissions are checked again when preparing and submitting a launch and for dashboard changes.

The repository reservation is persisted before preparation. A second launch cannot claim that repository while its review or signed transaction is live. A finalized project is never replaced by another mint. Closing a review does not prematurely release a still-valid blockhash; retry after its onchain expiry or recover the existing transaction.

Wallet ownership uses a five-minute, single-use signed message containing the origin, GitHub user ID, wallet, and nonce. Admins can approve contributor eligibility, but cannot assign a contributor's wallet. Neither wallet nor mint private keys are persisted. Browser recovery stores the **signed transaction bytes**, not a signing key.

## Funding semantics

- New Commit launches are exclusively paired with **Microsoft xStock (MSFTx)**, mint `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX`, with 8 decimals and Token-2022. This is the Microsoft asset returned by Pump.fun's supported quote catalog.
- The creator fee is fixed at **2% (200 basis points)** and its entire creator share accrues to the Pump.fun/PumpSwap vaults for **`GDKuQbSr9v6AzC5ZWzXvnkQFkWULB7eWmovgS451J6Ya`**. Pump.fun protocol fees are separate. The recipient collects those protocol fees; they are not automatically transferred to GitHub users.
- The browser and server enforce the same fixed policy, and the shared Pawns builder verifies the exact Microsoft mint, fee, and recipient against the simulated curve. Unsupported policy settings fail closed; there is no SOL fallback.
- Each coin has its own treasury ledger: verified lifetime earned fees, open-request reservations, verified paid totals, and unreserved earnings available to request. It is **not an onchain escrow or the shared collector's wallet balance**.
- Repository admins/maintainers and explicitly approved contributors can request MSFTx payouts to their signature-verified GitHub-linked wallet. Claims require fresh, complete per-coin fee indexing and cannot exceed unreserved earnings. Each user can have one pending/approved request per coin.
- **Claim / request payout** creates a request only. The operator reviews it at `/admin/payouts`, approves it, manually sends the exact MSFTx amount from the collection wallet, then supplies the transfer signature. Commit verifies the finalized receipt's collector signer, recipient net credit, asset, exact amount, and timing before marking it paid. Transaction signatures are unique across payouts.
- Pending requests can be cancelled by their requester or rejected by the operator. Approved requests remain reserved and cannot be cancelled; only approve a request when ready to settle it. Use one transfer transaction per request, after collecting any necessary protocol fees into the collection wallet.
- Operator authority is a server-side allowlist of immutable GitHub account IDs in `COMMIT_PAYOUT_ADMIN_IDS`. The production operator is `commit-pad` (ID `334859250`). Requests, approvals, rejections, cancellations, and paid receipts are audited.
- Maintainers may record treasury/maintainer/contributor/platform allocation policies in basis points, totaling 10,000.
- Contributor eligibility requires a maintainer decision, a substantive rationale, and repository PR/issue evidence. Raw commit counts never automatically grant rewards.
- Allocation settings are review targets, not automated onchain fee splits or individual entitlements. The operator determines which requests to approve; no application endpoint signs or broadcasts a contributor payout.

## Data provenance and limits

- Price, market cap, bonding curve, PumpSwap state, chart observations, order limits, and creator revenue come from Pawns' real infrastructure.
- Recent trades are finalized orders placed through this deployment. Their submitted limits are displayed, not invented exact fills or all-market trade history.
- Creator revenue is the lifetime per-token finalized fee ledger, not the shared treasury's current vault balance. Incomplete indexing remains visibly marked. The inherited ledger currently caps at 20,000 receipts per coin.
- 24h USD volume is the deduplicated sum of indexed Solana markets with the launched mint as the base token from DexScreener. A missing upstream result is **not** interpreted as zero volume.
- Holder counts require the configured DAS indexer. It counts distinct nonzero owners across up to 20,000 token accounts; missing pagination or a larger/incomplete scan remains unavailable.
- Dashboard metric charts record actual observations at five-minute buckets, with 30-day/global 100,000-observation retention. They do not backfill invented history.
- GitHub data is cached for five minutes. Development activity uses the most recent 100 public repository events and recent closed PRs; the UI explains that these are bounded windows. Repository IDs remain the identity anchor when names change.
- Trending is explicitly defined as bonding-curve progress, then GitHub stars. Unsupported metrics sort last. No fake trending score or seeded production tokens are used.

## Verification

- Commit TypeScript/Vite production build.
- 33 unit/API/indexer/production tests passed, including the main-coin exception (operator + main wallet only, SOL pair, one only), including renamed repositories, archived-repository claims, explicit claiming, report limits, and meta-tag escaping, including link-preview tags, README badges, reports, delisting, claimed status, fork labels, and operator alerts, including the per-user payouts listing and same-site sign-in return paths, including community launches of repositories the launcher does not maintain (no claim or settings access for the launcher), including fixed Microsoft/2%/recipient enforcement, exact per-coin reservations, duplicate claims, operator permissions, wallet ownership, stale index rejection, and finalized manual-transfer verification.
- Production server boot test covering independent storage and response security headers.
- 15 Chromium tests passed, including the main-coin option, its review and request, and pinning, including query-string routing, trailing slashes, the explore layout after Back, the ⌘K shortcut while typing, and a 320 px header, including the legal pages and report form, including the Payouts page (signed out and signed in), including a community launch by repository URL with its labels, including Microsoft-paired launch signing/recovery, claim submission without additional wallet signatures or broadcasts, operator approval/receipt recording, responsive layouts, and existing discovery behavior.
- Existing Pawns build, 33 unit tests, and 18 browser tests passed after shared changes.
- A real unsigned mainnet launch simulation passed for Microsoft xStock with the exact 2% fee and designated collector. It used no opening buy and did not broadcast a transaction. Optional opening buys spend MSFTx; SOL is still required for network fees and rent.
- Dependency audits reported zero known advisories at verification time.

Browser screenshots are generated under `test-results/` by `npm run test:browser`. Test wallets, RPC responses, and GitHub fixtures exist only in the test files, never as production launch fallbacks.

## Trust, listings, and alerts

- **Launch type and claims.** Community launches show the launcher, an endorsement disclaimer, and **claimed / unclaimed**: a coin becomes claimed the first time a GitHub-verified maintainer opens its dashboard or the Payouts page. Forks are labelled with the project they came from.
- **Terms.** The launch button stays disabled until the launcher confirms the Terms, risks, and no-impersonation rule.
- **Delisting.** The operator can delist a coin from a report. It disappears from listings and Commit's trade panel, and its page shows the public reason. The token stays onchain and its fees stay claimable.
- **Link previews.** `server/start.ts` rewrites `index.html`'s title, description, Open Graph, and X card tags per page (`lib/seo.ts`). Coin pages use the coin image; other pages use `public/og.png` (generated by the brand kit's `og.py`).
- **Alerts.** Set `COMMIT_ALERT_WEBHOOK` to a Discord (or Slack) incoming-webhook URL to be notified of new payout requests and reports. Delivery is best effort.

## Commit's main coin (the one exception)

Commit's own coin is the only launch that doesn't follow the Microsoft xStock / 2% / collection-wallet policy (`COMMIT_MAIN_POLICY` in `lib/pump/policy.ts`).
- **Who can launch it.** Only a signed-in Commit operator (`COMMIT_PAYOUT_ADMIN_IDS`) whose signing wallet is `COMMIT_MAIN_WALLET` (`78DuBUzNxoDQTVXFsBFWgtyNvCySsLQXLLiLn4uyvUw1`), from the "Launch as Commit's main coin" option on `/create` step 04. The server checks the operator at metadata, authorization, and submission, and checks the wallet at authorization, preparation, and submission.
- **What it is.** A standard SOL-paired Pump.fun coin with Pump.fun's standard creator fee. Its creator (fee recipient) is the main wallet, which claims the fees directly on Pump.fun, not through Commit payout requests.
- **Only one.** A second main coin is refused while one is pending or live.
- **Where it shows.** It is labelled "Main coin · pinned" and listed first everywhere: a pinned banner above the homepage and Explore lists, first in the ticker strip, and in its own link preview.
- **It still attaches to a public repository** you choose on step 01.
- `npm run check:mainnet` also runs an unsigned mainnet simulation of this policy (SOL, 0 bps custom fee, recipient = main wallet).
