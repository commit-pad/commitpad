import { afterEach, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createApp } from '../server/app'
import { GitHub } from '../lib/github/api'
import { SOL_ASSET, POLICY_VERSION } from '../packages/pump-core/client'
import { COMMIT_FEE_RECIPIENT, COMMIT_POLICY, MICROSOFT_ASSET } from '../lib/pump/policy'
import BN from 'bn.js'
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '../../pawn-solana/node_modules/@solana/web3.js'
import { MAINNET_GENESIS, verifySigned } from '../../pawn-solana/server/pump'
import type { createSolanaApi } from '../../pawn-solana/server/solana'

const { PUMP_SDK } = createRequire(new URL('../../pawn-solana/package.json', import.meta.url))('@pump-fun/pump-sdk') as typeof import('../../pawn-solana/node_modules/@pump-fun/pump-sdk')
const login0Cookies = (response: Response) => response.headers.getSetCookie().join('\n')
let server: Server | undefined, directory = '', app: ReturnType<typeof createApp> | undefined
afterEach(async () => { if (server) await new Promise<void>(done => { server!.closeAllConnections(); server!.close(() => done()) }); app?.store.db.close(); if (directory) await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() })

it('runs OAuth → verified repository → shared Pawns builder → signed finality → project, with authorization and recovery gates', async () => {
  directory = await mkdtemp('/tmp/opencode/commit-launch-test-')
  vi.stubEnv('COMMIT_DATA_DIR', directory); vi.stubEnv('COMMIT_PUBLIC_ORIGIN', 'https://commit.example')
  vi.stubEnv('COMMIT_SESSION_KEY', 'ab'.repeat(32)); vi.stubEnv('GITHUB_CLIENT_ID', 'test-client'); vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-only-secret'); vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('COMMIT_PAYOUT_ADMIN_IDS', '')
  const owner = Keypair.generate(), mint = Keypair.generate(), treasury = COMMIT_FEE_RECIPIENT, blockhash = Keypair.generate().publicKey.toBase58()
  let authorized = true, visible = true, finalized = false, sent = 0, builtRecipient = '', signed: VersionedTransaction | undefined
  const github = new GitHub(async input => {
    const url = new URL(String(input)), path = url.pathname
    const repo = { id: 123, owner: { login: 'builder', avatar_url: 'https://avatars.githubusercontent.com/u/1' }, name: 'software', description: 'Real code', private: !visible, archived: false, disabled: false, stargazers_count: 50, forks_count: 5, language: 'TypeScript', html_url: 'https://github.com/builder/software', pushed_at: '2026-09-20T12:00:00Z', permissions: { admin: authorized }, topics: ['tools'] }
    const data = path === '/user' ? { id: 1, login: 'builder', avatar_url: repo.owner.avatar_url } : path === '/repositories/123' || path === '/repos/builder/software' ? repo : path === '/user/repos' ? [repo] : path === '/users/contributor' ? { id: 2, login: 'contributor' } : []
    return new Response(JSON.stringify(data), { status: 200 })
  })
  type Options = NonNullable<Parameters<typeof createSolanaApi>[0]>
  const client = {
    getGenesisHash: async () => MAINNET_GENESIS,
    getAccountInfo: async (key: PublicKey) => key.equals(mint.publicKey) ? null : { executable: true },
    getSignatureStatuses: async () => ({ value: signed ? [{ err: null, confirmationStatus: finalized ? 'finalized' : 'confirmed' }] : [null] }),
    sendRawTransaction: async (bytes: Buffer) => { sent++; signed = VersionedTransaction.deserialize(bytes); return verifySigned(bytes.toString('base64'), bytes.toString('base64')).signature },
    getTransaction: async () => signed ? { meta: { err: null }, transaction: { message: signed.message }, blockTime: 1790000000 } : null,
    isBlockhashValid: async () => ({ context: { slot: 100 }, value: true }),
  } as unknown as Options['client']
  const build: Options['build'] = async (_connection, input) => {
    builtRecipient = input.feeRecipient!
    expect(input.requiredCreatorFeeBps).toBe(200)
    const instruction = await PUMP_SDK.createV2Instruction({ mint: new PublicKey(input.mint), user: new PublicKey(input.owner), creator: new PublicKey(input.feeRecipient!), name: input.name, symbol: input.symbol, uri: input.uri, mayhemMode: false, quoteMint: new PublicKey(MICROSOFT_ASSET.mint), creatorFeeBps: new BN(200) })
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message())
    return { transaction: Buffer.from(tx.serialize()).toString('base64'), blockhash, blockhashContextSlot: 1, lastValidBlockHeight: 1000, buyLamports: '0', buyAmount: '0', quote: MICROSOFT_ASSET, feeRecipient: input.feeRecipient!, creatorTaxBps: 200, policyVersion: POLICY_VERSION, minimumTokens: '0', networkFeeLamports: 10000, estimatedDebitLamports: 6000000, balanceLamports: 100000000 }
  }
  app = createApp({ github, oauthRequest: async () => new Response(JSON.stringify({ access_token: 'test-github-token' }), { status: 200 }), pump: { client, build } })
  server = createServer((req, res) => { void app!.handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let cookie = ''
  const get = (path: string) => fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' })
  const post = (path: string, body: unknown, origin = base) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await get('/api/commit/repositories')).status).toBe(401)
  const evil = login0Cookies(await get('/api/auth/login?next=//evil.example'))
  expect(evil).not.toContain('evil'); expect(evil).toMatch(/commit_next=; [^\n]*Max-Age=0/)
  const login = await get('/api/auth/login?next=/payouts'), authorization = new URL(login.headers.get('location')!)
  expect(authorization.origin).toBe('https://github.com')
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  expect(login.headers.get('set-cookie')).toContain('HttpOnly')
  expect(login.headers.get('set-cookie')).toContain('Secure')
  const callback = `/api/auth/callback?state=${authorization.searchParams.get('state')}&code=test-code`
  const response = await get(callback)
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe('/payouts')
  const oauthCookie = cookie.split('; ')[0]
  cookie = response.headers.get('set-cookie')!.split(';')[0]
  const sessionCookie = cookie
  cookie = oauthCookie; expect((await get(callback)).status).toBe(403); cookie = sessionCookie
  expect(JSON.stringify(app.store.db.prepare('SELECT * FROM sessions').all())).not.toContain('test-github-token')
  expect((await (await get('/api/commit/session')).json()).user.login).toBe('builder')
  expect((await post('/api/commit/repositories/verify', { id: 123 }, 'https://evil.example')).status).toBe(403)
  expect(await (await post('/api/commit/repositories/verify', { id: 123 })).json()).toMatchObject({ maintainer: true, launch: 'maintainer', repo: { id: 123 } })
  // Anyone may launch any active public repository: without admin/maintain permission it is a community launch.
  authorized = false
  const lookup = await post('/api/commit/repositories/verify', { repository: 'https://github.com/builder/software' })
  expect(lookup.status).toBe(200)
  expect(await lookup.json()).toMatchObject({ maintainer: false, launch: 'community', repo: { id: 123, owner: 'builder', name: 'software' } })
  expect((await post('/api/commit/repositories/verify', { repository: 'not a repository' })).status).toBe(400)
  visible = false
  expect((await post('/api/commit/repositories/verify', { repository: 'builder/software' })).status).toBe(403)
  visible = true
  const metadata = { repositoryId: 123, name: 'Software', symbol: 'CODE', description: 'Fund the code', website: '', twitter: '', telegram: '', image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=', imageType: 'image/png' }
  const upload = await post('/api/solana/metadata', metadata)
  expect(upload.status).toBe(200)
  const meta = await upload.json()
  const published = await (await get(new URL(meta.uri).pathname)).json()
  expect(published.github).toMatchObject({ id: 123, url: 'https://github.com/builder/software' })
  expect(published.commitLaunch).toMatchObject({ type: 'community', launchedBy: 'builder' })
  const body = { repositoryId: 123, treasury, category: 'Developer Tools', maintainerWallets: [], owner: owner.publicKey.toBase58(), mint: mint.publicKey.toBase58(), metadata: meta.hash, buy: '0', quoteMint: MICROSOFT_ASSET.mint, creatorTax: '2', policyVersion: POLICY_VERSION, commitPolicy: COMMIT_POLICY }
  expect((await post('/api/solana/prepare', { ...body, treasury: 'not-a-wallet' })).status).toBe(400)
  expect((await post('/api/solana/prepare', { ...body, quoteMint: SOL_ASSET.mint })).status).toBe(400)
  expect((await post('/api/solana/prepare', { ...body, creatorTax: '3' })).status).toBe(400)
  expect((await post('/api/solana/prepare', { ...body, commitPolicy: 'stale' })).status).toBe(400)
  const review = await post('/api/solana/prepare', body)
  expect(review.status, await review.clone().text()).toBe(200)
  const plan = await review.json()
  expect(builtRecipient).toBe(treasury)
  expect(plan.feeRecipient).toBe(treasury)
  expect((await post('/api/solana/prepare', { ...body, mint: Keypair.generate().publicKey.toBase58() })).status).toBe(409)
  expect((await (await get('/api/commit/projects')).json()).items).toEqual([])
  const tx = VersionedTransaction.deserialize(Buffer.from(plan.transaction, 'base64'))
  tx.sign([owner, mint])
  const signedBody = { id: plan.id, transaction: Buffer.from(tx.serialize()).toString('base64') }
  visible = false // the repository is re-checked at submission
  expect((await post('/api/solana/submit', signedBody)).status).toBe(403)
  expect(sent).toBe(0)
  visible = true
  expect((await post('/api/solana/submit', signedBody)).status).toBe(202)
  expect(sent).toBe(1)
  expect((await (await get('/api/commit/projects')).json()).items).toEqual([])
  expect((await (await get(`/api/solana/status/${plan.id}`)).json()).status).toBe('pending')
  finalized = true
  expect((await (await get(`/api/solana/status/${plan.id}`)).json()).status).toBe('confirmed')
  const projects = await (await get('/api/commit/projects')).json()
  expect(projects.items).toHaveLength(1)
  expect(projects.items[0]).toMatchObject({ treasury, fundingMode: 'manual-v1', launch: 'community', launchedBy: 'builder', repo: { id: 123 }, coin: { mint: mint.publicKey.toBase58(), feeRecipient: treasury, creatorTaxBps: 200, quote: MICROSOFT_ASSET } })
  expect((await get('/api/commit/projects/builder/software')).status).toBe(200)
  expect((await get('/api/commit/payouts/admin')).status).toBe(403)
  expect((await post('/api/commit/payouts/decide', { id: 'fake', action: 'approve', note: '' })).status).toBe(403)
  expect((await post('/api/commit/payouts/request', { repositoryId: 123, amount: '1', note: '', wallet: owner.publicKey.toBase58() })).status).toBe(403)
  expect((await (await get('/api/commit/project/123/treasury')).json()).canRequest).toBe(false)
  expect((await post('/api/solana/submit', signedBody)).status).toBe(200)
  expect(sent).toBe(1)
  expect((await post('/api/solana/prepare', body)).status).toBe(409)
  expect((await post('/api/commit/repositories/verify', { id: 123 })).status).toBe(409)
  // The community launcher gets no maintainer powers; the repository's real maintainers do.
  expect((await get('/api/commit/project/123/dashboard')).status).toBe(403)
  expect((await (await get('/api/commit/project/123/treasury')).json()).reason).toContain('Only maintainers of builder/software')
  expect((await (await get('/api/commit/payouts/mine')).json()).items).toEqual([])
  authorized = true
  // The repository's maintainer sees the community-launched coin on their payouts page.
  const mine = await (await get('/api/commit/payouts/mine')).json()
  expect(mine.items).toHaveLength(1)
  expect(mine.items[0]).toMatchObject({ role: 'maintainer', project: { launch: 'community', repo: { id: 123 } }, treasury: { repositoryId: 123 } })
  expect(mine.items[0].project.claimedBy).toBeUndefined() // looking never claims
  expect((await get('/api/commit/project/123/dashboard')).status).toBe(200)
  expect(app.store.project(123)!.claimedBy).toBeUndefined()
  expect((await post('/api/commit/claim', { repositoryId: 123 }, 'https://evil.example')).status).toBe(403)
  expect((await post('/api/commit/claim', { repositoryId: 123 })).status).toBe(200)
  expect(app.store.project(123)!.claimedBy).toBe('builder')
  // README badge
  const shield = await get('/badge/builder/software.svg')
  expect(shield.headers.get('content-type')).toContain('image/svg+xml'); expect(await shield.text()).toContain('$CODE')
  expect(await (await get('/badge/nobody/nothing.svg')).text()).toContain('launch on commit')
  // Reports need no account; operator views and delisting do.
  expect((await post('/api/commit/reports', { target: 'builder/software', reason: 'trademark', relationship: 'owner', details: 'short', contact: '@x' })).status).toBe(400)
  const filed = await post('/api/commit/reports', { target: 'https://commitpad.fun/builder/software', reason: 'trademark', relationship: 'owner', details: 'This coin uses our project name without permission.', contact: '@owner' })
  expect(filed.status).toBe(201)
  expect(app.store.reports('open')[0]).toMatchObject({ repositoryId: 123, reason: 'trademark', contact: '@owner' })
  const again = await post('/api/commit/reports', { target: 'builder/software', reason: 'impersonation', relationship: 'owner', details: 'Same coin again, reported from its repository name.', contact: '@OWNER' })
  expect((await again.json()).id).toBe((await filed.clone().json()).id) // duplicates merge
  for (let i = 0; i < 4; i++) expect((await post('/api/commit/reports', { target: `other/repo${i}`, reason: 'scam', relationship: 'holder', details: 'Another report to exercise the daily limit.', contact: `@h${i}` })).status).toBe(201)
  expect((await post('/api/commit/reports', { target: 'other/repo9', reason: 'scam', relationship: 'holder', details: 'One report too many from the same address.', contact: '@h9' })).status).toBe(429)
  expect((await get('/api/commit/admin/reports')).status).toBe(403)
  expect((await post('/api/commit/admin/reports/resolve', { id: (await filed.json()).id, status: 'resolved', note: '' })).status).toBe(403)
  expect((await post('/api/commit/admin/projects/visibility', { repositoryId: 123, hidden: true, reason: 'Trademark report' })).status).toBe(403)
  // A delisted coin leaves the listings but keeps its page (with the reason) and its treasury.
  app.store.updateProject(123, p => { p.hidden = { at: new Date().toISOString(), reason: 'Trademark report' } })
  expect((await (await get('/api/commit/projects')).json()).items).toEqual([])
  expect((await (await get('/api/commit/projects/builder/software')).json()).project.hidden.reason).toBe('Trademark report')
  expect((await get('/api/commit/project/123/treasury')).status).toBe(200)
  app.store.updateProject(123, p => { delete p.hidden })
  const eligibility = { repositoryId: 123, login: 'contributor', approved: true, reason: 'Reviewed and merged the new parser implementation.', evidence: ['https://github.com/builder/software/pull/12'] }
  expect((await post('/api/commit/contributors/approve', { ...eligibility, evidence: ['https://github.com/elsewhere/repo/pull/12'] })).status).toBe(400)
  expect((await post('/api/commit/contributors/approve', eligibility)).status).toBe(200)
  expect(app.store.eligibility(123)[0]).toMatchObject({ approved: true, login: 'contributor', wallet: null })
  authorized = false
  expect((await get('/api/commit/project/123/dashboard')).status).toBe(403)
  expect((await post('/api/commit/contributors/approve', eligibility)).status).toBe(403)
  expect((await post('/api/commit/settings', { repositoryId: 123, category: 'AI', allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 } })).status).toBe(403)
  expect((await post('/api/auth/logout', {})).status).toBe(200)
  expect((await get('/api/commit/repositories')).status).toBe(401)
})
