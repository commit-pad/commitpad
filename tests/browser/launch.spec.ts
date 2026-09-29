import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { POLICY_VERSION } from '../../../pawn-solana/src/solana/policy'
import { COMMIT_POLICY, COMMIT_FEE_RECIPIENT, COMMIT_MAIN_POLICY, COMMIT_MAIN_WALLET, MICROSOFT_ASSET, SOL_MINT } from '../../lib/pump/policy'
import type { Plan } from '../../packages/pump-core/client'
import type { Development, Project, Repository } from '../../lib/types'
const require = createRequire(new URL('../../../pawn-solana/package.json', import.meta.url))
const { PUMP_SDK } = require('@pump-fun/pump-sdk') as typeof import('../../../pawn-solana/node_modules/@pump-fun/pump-sdk')
const { Keypair, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js') as typeof import('../../../pawn-solana/node_modules/@solana/web3.js')
const BN = require('bn.js') as typeof import('bn.js')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=', 'base64')

async function fixture(page: Page, options: { mainWallet?: boolean; operator?: boolean } = {}) {
  const wallet = Keypair.generate(), treasury = COMMIT_FEE_RECIPIENT, blockhash = Keypair.generate().publicKey.toBase58()
  const state = { signCount: 0, submissions: 0, finalized: false, reject: false, plan: null as Plan | null, claims: 0, claimed: false, launch: 'maintainer' as 'maintainer' | 'community' }
  const repo: Repository = { id: 123, owner: 'builder', name: 'software', description: 'A developer toolkit built in public.', stars: 52, forks: 6, language: 'TypeScript', url: 'https://github.com/builder/software', avatar: '/commit.svg', updatedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), topics: ['tools'] }
  const development: Development = { repository: repo, contributors: [], contributorCount: 7, events: [], pulls: [], releases: [], fetchedAt: new Date().toISOString() }
  const project = (): Project => ({ repo, treasury, launch: state.launch, launchedBy: 'builder', ...(state.claimed ? { claimedAt: new Date().toISOString(), claimedBy: 'builder' } : {}), fundingMode: 'manual-v1', category: 'Developer Tools', allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 }, launchUser: 1, maintainerWallets: [], coin: { mint: state.plan!.mint, owner: wallet.publicKey.toBase58(), name: 'Software', symbol: 'CODE', description: repo.description, image: '/commit.svg', website: '', twitter: '', telegram: '', uri: '', signature: state.plan!.signature!, createdAt: Date.now(), quote: MICROSOFT_ASSET, feeRecipient: treasury, creatorTaxBps: 200 } })
  await page.exposeFunction('commitTestSign', (input: number[]) => {
    state.signCount++; if (state.reject) throw Error('Signature rejected by user')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(input))
    expect(tx.signatures.every(signature => signature.every(byte => byte === 0))).toBe(true)
    tx.sign([wallet]); return Array.from(tx.serialize())
  })
  await page.addInitScript(({ address, bytes }) => {
    const account = { address, publicKey: Uint8Array.from(bytes), chains: ['solana:mainnet'], features: ['solana:signTransaction'] }
    const wallet = { version: '1.0.0', name: 'Commit Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', chains: ['solana:mainnet'], accounts: [], features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0], signTransaction: async ({ transaction }: { transaction: Uint8Array }) => [{ signedTransaction: Uint8Array.from(await (window as any).commitTestSign(Array.from(transaction))) }] },
    } }
    const register = (api: any) => api.register(wallet)
    window.addEventListener('wallet-standard:app-ready', (event: any) => register(event.detail))
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
  }, options.mainWallet ? { address: COMMIT_MAIN_WALLET, bytes: Array.from(new PublicKey(COMMIT_MAIN_WALLET).toBytes()) } : { address: wallet.publicKey.toBase58(), bytes: Array.from(wallet.publicKey.toBytes()) })
  await page.route('**/api/commit/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/session')) return route.fulfill({ json: { user: { id: 1, login: 'builder', avatar: '/commit.svg', wallet: wallet.publicKey.toBase58() }, githubConfigured: true, payoutAdmin: !!options.operator } })
    if (path.endsWith('/launch-policy')) return route.fulfill({ json: { quote: MICROSOFT_ASSET, creatorFeeBps: 200, feeRecipient: treasury, version: COMMIT_POLICY, checkedAt: Date.now() } })
    if (path.endsWith('/treasury')) return route.fulfill({ json: { repositoryId: 123, collector: treasury, quote: MICROSOFT_ASSET, fees: { amount: '100000000', trades: 1, status: 'complete', updatedAt: Date.now() }, paid: '0', reserved: state.claims ? '25000000' : '0', available: state.claims ? '75000000' : '100000000', canRequest: !state.claims, reason: state.claims ? 'Your open request is awaiting review or manual payment.' : '', wallet: wallet.publicKey.toBase58(), fundingMode: 'manual-v1', requests: state.claims ? [{ id: 'request-1', repositoryId: 123, userId: 1, login: 'builder', wallet: wallet.publicKey.toBase58(), quoteMint: MICROSOFT_ASSET.mint, amount: '25000000', status: 'pending', note: '', decisionNote: '', createdAt: Date.now(), updatedAt: Date.now(), decidedBy: null, signature: null, paidAt: null }] : [] } })
    if (path.endsWith('/payouts/request')) { expect(route.request().postDataJSON().amount).toBe('0.25'); state.claims++; return route.fulfill({ status: 201, json: { ok: true } }) }
    if (path.endsWith('/repositories')) return route.fulfill({ json: { items: [repo], next: null } })
    if (path.endsWith('/repositories/verify')) { const maintainer = route.request().postDataJSON().repository === undefined; state.launch = maintainer ? 'maintainer' : 'community'; return route.fulfill({ json: { repo, development, maintainer, launch: state.launch } }) }
    if (path.endsWith('/projects')) return route.fulfill({ json: { items: state.finalized ? [project()] : [] } })
    if (path.endsWith('/projects/builder/software')) return route.fulfill({ json: { project: project() } })
    if (path.endsWith('/development')) return route.fulfill({ json: development })
    if (path.endsWith('/market')) return route.fulfill({ json: { volume24h: null, holders: null, updatedAt: new Date().toISOString(), source: 'test fixture', history: [] } })
    if (path.endsWith('/dashboard')) return route.fulfill({ json: { project: project(), eligibility: [] } })
    if (path.endsWith('/claim')) { state.claimed = true; return route.fulfill({ json: { project: { ...project(), claimedAt: new Date().toISOString(), claimedBy: 'builder' } } }) }
    if (path.endsWith('/payouts/mine')) return route.fulfill({ json: { wallet: wallet.publicKey.toBase58(), items: state.plan ? [{ project: project(), role: 'maintainer', treasury: { repositoryId: 123, collector: treasury, quote: MICROSOFT_ASSET, fees: { amount: '100000000', trades: 1, status: 'complete', updatedAt: Date.now() }, paid: '0', reserved: state.claims ? '25000000' : '0', available: state.claims ? '75000000' : '100000000', canRequest: !state.claims, reason: '', wallet: wallet.publicKey.toBase58(), fundingMode: 'manual-v1', requests: [] } }] : [] } })
    throw Error(`Unexpected Commit fixture endpoint ${path}`)
  })
  await page.route('**/api/solana/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/metadata')) { expect(route.request().postDataJSON().repositoryId).toBe(123); return route.fulfill({ json: { hash: 'a'.repeat(64) } }) }
    if (path.endsWith('/prepare')) {
      const body = route.request().postDataJSON(); expect(body.treasury).toBe(treasury); expect(body.repositoryId).toBe(123); expect(body.quoteMint).toBe(MICROSOFT_ASSET.mint); expect(body.creatorTax).toBe('2'); expect(body.commitPolicy).toBe(COMMIT_POLICY)
      const ix = await PUMP_SDK.createV2Instruction({ mint: new PublicKey(body.mint), user: wallet.publicKey, creator: new PublicKey(treasury), name: 'Software', symbol: 'CODE', uri: 'https://commit.example/metadata/test.json', mayhemMode: false, quoteMint: new PublicKey(MICROSOFT_ASSET.mint), creatorFeeBps: new BN(200) })
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message())
      state.plan = { id: '11111111-1111-4111-8111-111111111111', mint: body.mint, owner: body.owner, transaction: Buffer.from(tx.serialize()).toString('base64'), blockhash, createdAt: Date.now(), expiresAt: Date.now() + 45000, name: 'Software', symbol: 'CODE', uri: 'https://commit.example/metadata/test.json', buyLamports: '0', buyAmount: '0', quote: MICROSOFT_ASSET, feeRecipient: treasury, creatorTaxBps: 200, policyVersion: POLICY_VERSION, minimumTokens: '0', networkFeeLamports: 10000, estimatedDebitLamports: 6000000, balanceLamports: 1000000000, status: 'review' }
      return route.fulfill({ json: state.plan })
    }
    if (path.endsWith('/submit')) {
      const tx = VersionedTransaction.deserialize(Buffer.from(route.request().postDataJSON().transaction, 'base64'))
      for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) expect(nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[i], tx.message.staticAccountKeys[i].toBytes())).toBe(true)
      state.submissions++; state.plan = { ...state.plan!, signature: bs58.encode(tx.signatures[0]), status: 'pending' }
      return route.fulfill({ status: 202, json: state.plan })
    }
    if (path.includes('/status/')) return route.fulfill({ json: { ...state.plan!, status: state.finalized ? 'confirmed' : state.plan!.status } })
    if (path.includes('/market/')) return route.fulfill({ json: { market: { mint: state.plan!.mint, quote: MICROSOFT_ASSET, tokenDecimals: 6, price: .000001, fdv: 1000, raised: 1, progress: 5, route: 'curve', supply: '1000000000000000', updatedAt: Date.now(), feeRecipient: treasury, creatorTaxBps: 200 }, history: [820, 840, 815, 876, 885, 857, 912, 908, 951, 972, 967, 1000].map((fdv, index) => ({ time: Date.now() - (11 - index) * 60000, fdv, price: fdv / 1e9 })), trades: [], creatorFees: { amount: '100000000', trades: 1, status: 'complete', updatedAt: Date.now() } } })
    throw Error(`Unexpected Pawns fixture endpoint ${path}`)
  })
  return { state, treasury }
}

async function review(page: Page, treasury: string, community = false) {
  await page.goto('/create')
  if (community) {
    await page.getByLabel('Any public GitHub repository').fill('https://github.com/builder/software')
    await page.getByRole('button', { name: 'Use repository' }).click()
    await expect(page.getByText('You don’t maintain builder/software', { exact: false })).toBeVisible()
  } else await page.getByRole('button', { name: /builder \/ software/ }).click()
  await page.getByLabel('Token name', { exact: true }).fill('Software')
  await page.getByLabel('Ticker', { exact: true }).fill('CODE')
  await page.locator('input[type=file]').setInputFiles({ name: 'project.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Connect Solana wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Commit Test Wallet' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.locator('.review-summary')).not.toContainText(treasury) // Commit's pages no longer show the collection wallet
  await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toBeDisabled() // until the terms box is ticked
  await page.getByLabel('I’ve read the Terms', { exact: false }).check()
  await expect(page.locator('.review-summary')).toContainText(community ? 'Community launch by @builder' : 'Maintainer launch')
  await page.getByRole('button', { name: 'LAUNCH', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm launch in wallet' })).toBeVisible()
  await expect(page.locator('label', { hasText: 'Creator-fee recipient' }).locator('.sol-address')).toHaveText(treasury) // the signing review still shows the exact fee recipient
}

test('launches with both signatures, recovers after reload, and opens the repository token page', async ({ page }) => {
  const { state, treasury } = await fixture(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await review(page, treasury)
  expect(state.signCount).toBe(0)
  await page.getByRole('button', { name: 'Confirm launch in wallet' }).click()
  await expect.poll(() => state.submissions).toBe(1)
  await page.reload(); state.finalized = true
  await expect(page).toHaveURL('/builder/software', { timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'builder / software' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect wallet to trade' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Market cap history in MSFTx' })).toBeVisible()
  await expect(page.locator('.instrument-subline')).toContainText('Maintainer launch')
  await page.getByRole('button', { name: 'Claim / request payout', exact: true }).click()
  await page.getByLabel('Amount · MSFTx', { exact: true }).fill('0.25')
  await page.getByRole('button', { name: 'Submit claim request', exact: true }).click()
  await expect(page.getByText('Claim request received.', { exact: false })).toBeVisible()
  expect(state.claims).toBe(1)
  expect(state.signCount).toBe(1)
  expect(state.submissions).toBe(1)
  await page.screenshot({ path: 'test-results/commit-project-desktop.png', fullPage: true })
  expect(state.signCount).toBe(1); expect(state.submissions).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('pawn-solana-pending-v1'))).toBeNull()
  await page.goto('/dashboard/builder/software')
  await expect(page.getByRole('heading', { name: 'The project at a glance.' })).toBeVisible()
  await page.screenshot({ path: 'test-results/commit-dashboard-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Contributors' }).click()
  await expect(page.getByRole('heading', { name: 'Record an eligibility decision' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/commit-dashboard-mobile.png', fullPage: true })
  await page.goto('/builder/software')
  await expect(page.getByRole('heading', { name: 'Proof of work.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
})

test('anyone can launch a public repository they do not maintain, and it is labelled a community launch', async ({ page }) => {
  const { state, treasury } = await fixture(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await review(page, treasury, true)
  await page.getByRole('button', { name: 'Confirm launch in wallet' }).click()
  await expect.poll(() => state.submissions).toBe(1)
  await page.reload(); state.finalized = true
  await expect(page).toHaveURL('/builder/software', { timeout: 15000 })
  await expect(page.locator('.instrument-subline')).toContainText('Community launch')
  await expect(page.getByText('It was not created or endorsed by the maintainers of builder/software', { exact: false })).toBeVisible()
  await expect(page.locator('.instrument-subline')).toContainText('unclaimed')
  await expect(page.locator('.readme-badge')).toBeVisible()
  await page.getByRole('link', { name: 'report this coin' }).click() // an in-app link with a query string
  await expect(page.getByRole('heading', { name: 'Report a coin.' })).toBeVisible()
  await expect(page.getByLabel('Coin', { exact: true })).toHaveValue('builder/software')
  await page.goBack()
  await page.screenshot({ path: 'test-results/commit-project-community-desktop.png', fullPage: true })
  await page.goto('/unclaimed')
  await expect(page.getByRole('heading', { name: 'Unclaimed fees.' })).toBeVisible()
  await expect(page.locator('table')).toContainText('@builder')
  await page.goto('/') // the homepage market shows project cards
  await expect(page.locator('.project-card .card-foot').first()).toContainText('community · unclaimed')
  expect(errors).toEqual([])
})

test('the payouts page connects GitHub, then lists every claimable coin without showing the collection wallet', async ({ page }) => {
  const { state, treasury } = await fixture(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await review(page, treasury, true)
  await page.getByRole('button', { name: 'Confirm launch in wallet' }).click()
  await expect.poll(() => state.submissions).toBe(1)
  await page.reload(); state.finalized = true
  await expect(page).toHaveURL('/builder/software', { timeout: 15000 }) // recovery finishes the launch first
  await page.goto('/payouts')
  await expect(page.getByRole('heading', { name: 'Request your payout.' })).toBeVisible()
  await expect(page.locator('.payout-coin')).toContainText('builder / software')
  await expect(page.locator('.payout-coin')).toContainText('you are a maintainer')
  await expect(page.locator('.payout-coin')).toContainText('Community launch')
  await expect(page.locator('main')).not.toContainText(treasury)
  await page.screenshot({ path: 'test-results/commit-payouts-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Claim this coin' }).click()
  await expect(page.getByText('You claimed builder/software', { exact: false })).toBeVisible()
  expect(state.claimed).toBe(true)
  await expect(page.getByRole('button', { name: 'Claim this coin' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Request payout', exact: true }).click()
  await page.getByRole('button', { name: 'Use available amount' }).click()
  await expect(page.getByLabel('Amount · MSFTx')).toHaveValue('1')
  await page.getByLabel('Amount · MSFTx').fill('0.25')
  await page.getByRole('button', { name: 'Submit payout request' }).click()
  await expect(page.getByText('Payout request received for builder/software', { exact: false })).toBeVisible()
  expect(state.claims).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
})

test('signed-out visitors are asked to connect GitHub for the payout', async ({ page }) => {
  await page.route('**/api/commit/session', route => route.fulfill({ json: { user: null, githubConfigured: true } }))
  await page.route('**/api/commit/projects', route => route.fulfill({ json: { items: [] } }))
  await page.goto('/payouts')
  await expect(page.getByRole('heading', { name: 'Connect your GitHub for the payout.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Connect GitHub' })).toHaveAttribute('href', '/api/auth/login?next=/payouts')
  await expect(page.getByRole('link', { name: 'Payouts', exact: true })).toBeVisible()
})

async function toWalletStep(page: Page) {
  await page.goto('/create')
  await page.getByRole('button', { name: /builder \/ software/ }).click()
  await page.getByLabel('Token name', { exact: true }).fill('Commit')
  await page.getByLabel('Ticker', { exact: true }).fill('COMMIT')
  await page.locator('input[type=file]').setInputFiles({ name: 'project.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Connect Solana wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Commit Test Wallet' }).click()
}

test('the operator launches Commit’s main coin from the main wallet: SOL pair, standard fee, fees to that wallet', async ({ page }) => {
  await fixture(page, { mainWallet: true, operator: true })
  let metadata: Record<string, unknown> | null = null, prepared: Record<string, unknown> | null = null
  await page.route('**/api/solana/metadata', route => { metadata = route.request().postDataJSON(); return route.fulfill({ json: { hash: 'b'.repeat(64) } }) })
  await page.route('**/api/solana/prepare', route => { prepared = route.request().postDataJSON(); return route.fulfill({ status: 400, json: { error: 'Stopped after review in this test.' } }) })
  await toWalletStep(page)
  await page.getByLabel('Launch as Commit’s main coin', { exact: false }).check()
  await expect(page.getByLabel('Optional opening buy · SOL')).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.locator('.review-summary')).toContainText('Commit main coin · pinned')
  await expect(page.locator('.review-summary')).toContainText('Solana mainnet / SOL (standard Pump.fun)')
  await page.getByLabel('I’ve read the Terms', { exact: false }).check()
  await page.getByRole('button', { name: 'LAUNCH', exact: true }).click()
  await expect(page.getByText('Stopped after review in this test.')).toBeVisible()
  expect(metadata).toMatchObject({ commitPolicy: COMMIT_MAIN_POLICY })
  expect(prepared).toMatchObject({ commitPolicy: COMMIT_MAIN_POLICY, quoteMint: SOL_MINT, creatorTax: '0', treasury: COMMIT_MAIN_WALLET, owner: COMMIT_MAIN_WALLET })
})

test('no one else is offered the main coin exception', async ({ page }) => {
  await fixture(page, { operator: true }) // operator, but not the main wallet
  await toWalletStep(page)
  await expect(page.getByText('Launch as Commit’s main coin')).toHaveCount(0)
  await expect(page.getByLabel('Optional opening buy · MSFTx')).toBeVisible()
})

test('the main coin is pinned and labelled everywhere', async ({ page }) => {
  const { state } = await fixture(page)
  const main = { repo: { id: 9, owner: 'commit-pad', name: 'commitpad', description: 'Commit itself.', stars: 1, forks: 0, language: 'TypeScript', url: 'https://github.com/commit-pad/commitpad', avatar: '/commit.svg', updatedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), topics: [] }, coin: { mint: 'main-mint', name: 'Commit', symbol: 'COMMIT', image: '/commit.svg', createdAt: Date.now(), quote: { mint: SOL_MINT, symbol: 'SOL', decimals: 9 } }, treasury: COMMIT_MAIN_WALLET, main: true, launch: 'maintainer', category: 'Open Source', allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 }, launchUser: 1, maintainerWallets: [], discovery: { contributors: 1, volume24h: null, revenue: null, measuredAt: null } }
  void state
  await page.route('**/api/commit/projects', route => route.fulfill({ json: { items: [main] } }))
  await page.goto('/')
  await expect(page.locator('.main-pin')).toContainText('$COMMIT')
  await expect(page.locator('.main-pin')).toContainText('pinned · main coin')
  await expect(page.locator('.project-card .card-foot').first()).toContainText('main coin')
  await expect(page.locator('.strip-main')).toHaveText('main')
})

test('wallet rejection never publishes or submits a token', async ({ page }) => {
  const { state, treasury } = await fixture(page); state.reject = true
  await review(page, treasury)
  await page.getByRole('button', { name: 'Confirm launch in wallet' }).click()
  await expect(page.getByRole('alert').first()).toContainText('Signature rejected')
  expect(state.submissions).toBe(0); expect(state.finalized).toBe(false)
})
