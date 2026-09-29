import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createSolanaApi, createRateLimiter, clientIp, HttpError, readJson, connection, feeBalances, readPairs } from '../packages/pump-core/server'
import { createStore } from '../lib/repositories/store'
import { createAuth } from '../lib/github/auth'
import { GitHub } from '../lib/github/api'
import { createIntegration } from '../lib/repositories/integration'
import { createContributors, validateAllocations } from '../lib/contributors/service'
import { categories, type Category, type Development } from '../lib/types'
import { createMarketIndex } from '../lib/indexer/market'
import { COMMIT_CREATOR_FEE_BPS, COMMIT_FEE_RECIPIENT, COMMIT_POLICY, MICROSOFT_ASSET } from '../lib/pump/policy'
import { createPayouts, type PayoutReceipt } from '../lib/contributors/payouts'
import type { CoinFeeStats } from '../packages/pump-core/client'
import { randomUUID } from 'node:crypto'
import { createAlerts, quote, type Alerts } from '../lib/alerts'
import { badge } from '../lib/seo'
import { reportReasons, reportRelationships, type Project, type Report } from '../lib/types'

export function createApp(dependencies: { github?: GitHub; oauthRequest?: typeof fetch; pump?: Pick<NonNullable<Parameters<typeof createSolanaApi>[0]>, 'client' | 'build'>; fees?: (mint: string) => Promise<CoinFeeStats>; payoutReceipt?: (signature: string) => Promise<PayoutReceipt | null>; alerts?: Alerts } = {}) {
  const origin = process.env.COMMIT_PUBLIC_ORIGIN || 'https://localhost:5190'
  const url = new URL(origin)
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw Error('COMMIT_PUBLIC_ORIGIN must be an HTTPS origin.')
  const directory = resolve(process.env.COMMIT_DATA_DIR || '.commit-data')
  // Commit owns independent protocol state. Never point these paths at Pawns production.
  process.env.SOLANA_DATA_DIR = resolve(directory, 'solana')
  process.env.PAWN_UPLOAD_DIR = resolve(directory, 'uploads')
  process.env.PAWN_PUBLIC_ORIGIN = origin
  const store = createStore(resolve(directory, 'commit.sqlite'))
  const github = dependencies.github || new GitHub(), auth = createAuth(store, github, { origin, clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, encryptionKey: process.env.COMMIT_SESSION_KEY }, dependencies.oauthRequest)
  let pump: ReturnType<typeof createSolanaApi>
  pump = createSolanaApi({ ...dependencies.pump, integration: createIntegration(store, auth, github, () => pump, user => payouts.isAdmin(user)) })
  const contributors = createContributors(store, origin), limited = createRateLimiter(), market = createMarketIndex(), alerts = dependencies.alerts || createAlerts()
  const rpc = dependencies.pump?.client || connection()
  const payouts = createPayouts(store, auth, github, dependencies.fees || (mint => pump.creatorRevenue(mint)), dependencies.payoutReceipt || (async signature => {
    const response = await fetch(rpc.rpcEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1 }] }), signal: AbortSignal.timeout(20000) })
    const value = await response.json() as { result?: PayoutReceipt | null; error?: unknown }
    if (!response.ok || value.error || value.result === undefined) throw new HttpError(503, 'Finalized transfer verification is unavailable. The request remains approved; retry the same signature.')
    return value.result
  }))
  const developments = new Map<number, { until: number; value: Promise<Development> }>()
  async function development(repo: Parameters<GitHub['development']>[0], token?: string) {
    let cached = developments.get(repo.id)
    if (!cached || cached.until < Date.now()) {
      // Visitors read with their own token; the background refresh (no token) uses the server's read token.
      const value = github.development(repo, token || process.env.GITHUB_READ_TOKEN).then(data => {
        // Only launched repositories are stored, and a rename on GitHub is followed.
        if (store.project(repo.id)) { store.saveSnapshot(repo.id, data); store.renamed(data.repository); invalidate() }
        return data
      })
      for (const [id, entry] of developments) if (entry.until < Date.now() || developments.size > 400) developments.delete(id)
      const entry = { until: Date.now() + 300000, value }; cached = entry; developments.set(repo.id, entry)
      void value.catch(() => { entry.until = Date.now() + 60000 }) // cache failures briefly instead of re-asking GitHub per request
    }
    return cached.value
  }
  // New finalized launches are recorded on every call (cheap, in-memory); the merged list, which parses every
  // repository snapshot, is shared for a few seconds and rebuilt immediately after anything changes.
  type Listed = Awaited<ReturnType<typeof store.projects>>[number] & { discovery: NonNullable<Project['discovery']> }
  let listing: { at: number; value: Listed[] } | null = null
  const invalidate = () => { listing = null }
  async function syncProjects() {
    const coins = await pump.launches()
    if (publishFinalized(coins)) invalidate()
    if (!listing || Date.now() - listing.at > 3000) listing = { at: Date.now(), value: merged(coins) }
    return listing.value
  }
  function publishFinalized(coins: Awaited<ReturnType<typeof pump.launches>>) {
    let published = false
    for (const intent of store.intents()) {
      const coin = coins.find(c => c.mint === intent.mint)
      if (!coin || coin.owner !== intent.owner || coin.feeRecipient !== intent.treasury) continue
      try {
        if (!store.project(intent.repo.id)) {
          store.publish({ repo: intent.repo, coin, treasury: intent.treasury, launchUser: intent.userId, launch: intent.launch || 'maintainer', launchedBy: intent.launchedBy, ...(intent.main ? { main: true } : {}), category: intent.category, maintainerWallets: intent.maintainerWallets, fundingMode: intent.fundingMode, allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 } })
          store.audit(intent.userId, 'repository.launch.finalized', intent.repo.id, { mint: coin.mint, signature: coin.signature })
          published = true
        }
        store.release(intent.mint) // finalized: the reservation is no longer needed
      } catch { console.error(`Commit could not record the finalized launch for repository ${intent.repo.id}; retrying on the next refresh.`) }
    }
    return published
  }
  function merged(coins: Awaited<ReturnType<typeof pump.launches>>): Listed[] {
    // Commit's main coin is always listed first (pinned).
    return store.projects().sort((a, b) => Number(!!b.main) - Number(!!a.main)).map(project => {
      const snapshot = store.snapshot(project.repo.id), latest = store.latestMetrics(project.repo.id)
      const recent = latest && Date.now() - latest.time < 10 * 60000
      return { ...project, repo: snapshot?.repository || project.repo, coin: coins.find(c => c.mint === project.coin.mint) || project.coin, discovery: { contributors: snapshot?.contributorCount ?? null, volume24h: recent ? latest.volume24h : null, revenue: latest?.revenue ?? null, measuredAt: latest?.time ?? null } }
    })
  }
  async function sample(project: ReturnType<typeof store.projects>[number]) {
    const [extra, fees] = await Promise.all([market(project.coin.mint), pump.creatorRevenue(project.coin.mint)])
    const revenue = fees.amount !== null && fees.status === 'complete' ? Number(fees.amount) / 10 ** (project.coin.quote?.decimals || 9) : null
    store.observe(project.repo.id, { time: Date.parse(extra.updatedAt), volume24h: extra.volume24h, holders: extra.holders, revenue })
    const history = store.history(project.repo.id), step = Math.max(1, Math.ceil(history.length / 600))
    return { ...extra, history: history.filter((_, index) => index % step === 0 || index === history.length - 1) }
  }
  const reply = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) }); res.end(JSON.stringify(data)) }
  let active = 0
  const reportsByIp = new Map<string, number[]>()
  const clients = new Map<string, number>()
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const requestUrl = new URL(req.url || '/', origin), path = requestUrl.pathname
    const badgePath = /^\/badge\/([\w.-]{1,100})\/([\w.-]{1,100})\.svg$/.exec(path)
    if (badgePath && (req.method === 'GET' || req.method === 'HEAD')) {
      const project = store.bySlug(badgePath[1], badgePath[2]), svg = badge(project)
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(req.method === 'HEAD' ? undefined : svg); return true
    }
    if (!path.startsWith('/api/commit/') && !path.startsWith('/api/auth/')) {
      if (path === '/api/solana/fees' || path === '/api/solana/fees/prepare') { reply(res, 404, { error: 'Use the per-coin treasury to request a manual payout. The collection wallet claims protocol fees through Pump.fun.' }); return true }
      return pump.handler(req, res)
    }
    const ip = clientIp(req)
    if (!limited(ip, req.method === 'GET' ? 'read' : 'write') || active >= 64 || (clients.get(ip) || 0) >= 4) { reply(res, 429, { error: 'Too many requests. Retry in one minute.' }); return true }
    active++; clients.set(ip, (clients.get(ip) || 0) + 1)
    try {
      if (req.method === 'GET' && path === '/api/auth/login') { auth.start(res, requestUrl.searchParams.get('next')); return true }
      if (req.method === 'GET' && path === '/api/auth/callback') { await auth.callback(req, res, requestUrl); return true }
      if (req.method === 'GET' && path === '/api/commit/session') { const user = auth.session(req)?.user || null; reply(res, 200, { user, githubConfigured: auth.available, payoutAdmin: payouts.isAdmin(user) }); return true }
      if (req.method === 'GET' && path === '/api/commit/launch-policy') {
        const pairs = await readPairs(rpc, false, COMMIT_CREATOR_FEE_BPS), quote = pairs.assets.find(asset => asset.mint === MICROSOFT_ASSET.mint)
        if (!quote || quote.decimals !== MICROSOFT_ASSET.decimals || quote.tokenProgram !== MICROSOFT_ASSET.tokenProgram || !pairs.creatorFeeEnabled || pairs.maxCreatorFeeBps < COMMIT_CREATOR_FEE_BPS) throw new HttpError(503, 'Microsoft pairing with a 2% creator fee is currently unavailable on Pump.fun. Launches are paused until this exact policy is supported.')
        reply(res, 200, { quote, creatorFeeBps: COMMIT_CREATOR_FEE_BPS, feeRecipient: COMMIT_FEE_RECIPIENT, version: COMMIT_POLICY, checkedAt: Date.now() }); return true
      }
      if (req.method === 'GET' && path === '/api/commit/payouts/admin') {
        payouts.requireAdmin(req)
        const status = requestUrl.searchParams.get('status') || 'pending', page = Number(requestUrl.searchParams.get('page') || 1)
        if (!['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(status) || !Number.isInteger(page) || page < 1 || page > 10000) throw new HttpError(400, 'Invalid payout status or page.')
        const items = payouts.ledger.queue(status, page).map(row => { const project = store.project(row.repositoryId)!; return { ...row, repository: `${project.repo.owner}/${project.repo.name}`, symbol: project.coin.symbol, quote: project.coin.quote!, tokenMint: project.coin.mint } })
        reply(res, 200, { items, page, next: items.length === 100 ? page + 1 : null, collector: COMMIT_FEE_RECIPIENT }); return true
      }
      if (req.method === 'GET' && path === '/api/commit/payouts/mine') {
        // Every coin whose fees this GitHub user can claim: repositories they maintain (whoever launched the coin)
        // and repositories where a maintainer approved them as a contributor.
        const session = auth.requireSession(req), projects = await syncProjects(), managed = new Set<number>()
        for (let page: number | null = 1, pages = 0; page && pages < 10; pages++) { const found = await github.repositories(session.token, page, { forClaims: true }); found.items.forEach(repo => managed.add(repo.id)); page = found.next }
        const approved = (id: number) => store.eligibility(id).some(item => item.userId === session.user.id && item.approved)
        const mine = projects.filter(project => managed.has(project.repo.id) || approved(project.repo.id))
        const claimed = (id: number) => { const stored = store.project(id); return { claimedAt: stored?.claimedAt, claimedBy: stored?.claimedBy } }
        const items = await Promise.all(mine.map(async project => ({ project: { ...project, ...claimed(project.repo.id) }, role: managed.has(project.repo.id) ? 'maintainer' : 'contributor', treasury: await payouts.summary(req, project) })))
        reply(res, 200, { items, wallet: store.wallet(session.user.id) || null }); return true
      }
      if (req.method === 'GET' && path === '/api/commit/admin/reports') {
        payouts.requireAdmin(req)
        const status = requestUrl.searchParams.get('status') || 'open'
        if (!['open', 'resolved', 'dismissed'].includes(status)) throw new HttpError(400, 'Invalid report status.')
        reply(res, 200, { items: store.reports(status as Report['status']).map(report => ({ ...report, project: report.repositoryId ? store.project(report.repositoryId) || null : null })) }); return true
      }
      if (req.method === 'GET' && path === '/api/commit/payouts/collection') { payouts.requireAdmin(req); reply(res, 200, await feeBalances(rpc, [MICROSOFT_ASSET], COMMIT_FEE_RECIPIENT)); return true }
      if (req.method === 'GET' && path === '/api/commit/repositories') {
        const session = auth.requireSession(req), page = Number(requestUrl.searchParams.get('page') || 1)
        if (!Number.isInteger(page) || page < 1 || page > 100) throw new HttpError(400, 'Invalid repository page.')
        reply(res, 200, await github.repositories(session.token, page, { forClaims: requestUrl.searchParams.get('for') === 'claims' })); return true
      }
      if (req.method === 'GET' && path === '/api/commit/projects') { reply(res, 200, { items: (await syncProjects()).filter(project => !project.hidden) }); return true }
      const projectPath = /^\/api\/commit\/projects\/([^/]+)\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && projectPath) {
        const projects = await syncProjects(), slug = `${projectPath[1]}/${projectPath[2]}`.toLowerCase()
        const project = projects.find(p => `${p.repo.owner}/${p.repo.name}`.toLowerCase() === slug) || projects.find(p => p.repo.id === store.bySlug(projectPath[1], projectPath[2])?.repo.id)
        if (!project) throw new HttpError(404, 'This repository has no finalized Commit launch.')
        reply(res, 200, { project }); return true
      }
      const detail = /^\/api\/commit\/project\/(\d+)\/(development|market|dashboard|treasury)$/.exec(path)
      if (req.method === 'GET' && detail) {
        await syncProjects()
        const project = store.project(Number(detail[1])); if (!project) throw new HttpError(404, 'Project not found.')
        if (detail[2] === 'market') reply(res, 200, await sample(project))
        else if (detail[2] === 'development') reply(res, 200, await development(project.repo, auth.session(req)?.token))
        else if (detail[2] === 'treasury') reply(res, 200, await payouts.summary(req, project))
        else {
          const session = auth.requireSession(req)
          const repo = await github.verify(project.repo.id, session.token, { forClaims: true })
          reply(res, 200, { project: { ...store.project(project.repo.id)!, repo }, eligibility: store.eligibility(repo.id), user: session.user })
        }
        return true
      }
      if (req.method !== 'POST') throw new HttpError(404, 'Endpoint not found.')
      const input = await readJson(req, 20000, origin)
      if (path === '/api/auth/logout') { auth.logout(req, res); reply(res, 200, { ok: true }); return true }
      if (path === '/api/commit/reports') {
        // Takedown / impersonation reports. No account needed: project owners may not use Commit.
        const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max ? value.trim() : null
        const target = text(input.target, 300), details = text(input.details, 2000), contact = text(input.contact, 200)
        if (!target) throw new HttpError(400, 'Enter the coin page, repository (owner/name) or mint you are reporting.')
        if (!reportReasons.includes(input.reason as Report['reason'])) throw new HttpError(400, 'Choose a reason.')
        if (!reportRelationships.includes(input.relationship as Report['relationship'])) throw new HttpError(400, 'Choose how you are related to the project.')
        if (!details || details.length < 20) throw new HttpError(400, 'Describe the problem in at least 20 characters.')
        if (!contact || contact.length < 3) throw new HttpError(400, 'Leave an email or X/GitHub handle so we can follow up.')
        const recent = (reportsByIp.get(ip) || []).filter(at => at > Date.now() - 86400000)
        if (recent.length >= 5) throw new HttpError(429, 'You have sent 5 reports today. Contact @commitpadfun on X for anything urgent.')
        if (store.openReports() >= 500) throw new HttpError(503, 'Too many open reports right now. Retry later or contact @commitpadfun on X.')
        const slug = /(?:commitpad\.fun\/|github\.com\/|^)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/.exec(target)
        const project = (slug && store.bySlug(slug[1], slug[2])) || store.projects().find(p => p.coin.mint === target)
        const duplicate = store.reports('open').find(r => r.contact.toLowerCase() === contact.toLowerCase() && (r.target.toLowerCase() === target.toLowerCase() || (project && r.repositoryId === project.repo.id)))
        if (duplicate) { reply(res, 201, { id: duplicate.id }); return true }
        reportsByIp.set(ip, [...recent, Date.now()]); if (reportsByIp.size > 5000) reportsByIp.clear()
        const report: Report = { id: randomUUID(), target, repositoryId: project?.repo.id ?? null, reason: input.reason as Report['reason'], relationship: input.relationship as Report['relationship'], details, contact, status: 'open', note: '', createdAt: Date.now(), updatedAt: Date.now() }
        store.addReport(report); store.audit(0, 'report.created', report.repositoryId, { id: report.id, reason: report.reason })
        alerts.send(`New Commit report (${report.reason}) about ${project ? `${project.repo.owner}/${project.repo.name}` : quote(target)}. Review: ${origin}/admin/payouts#reports`)
        reply(res, 201, { id: report.id }); return true
      }
      const session = auth.requireSession(req)
      if (path === '/api/commit/claim') {
        // A maintainer publicly claims a community-launched coin. Viewing pages never does this.
        const project = store.project(Number(input.repositoryId)); if (!project) throw new HttpError(404, 'Project not found.')
        if (project.launch !== 'community') throw new HttpError(400, 'Only community launches are claimed; maintainer launches already belong to their maintainers.')
        await github.verify(project.repo.id, session.token, { forClaims: true })
        store.markClaimed(project.repo.id, session.user.login); invalidate()
        reply(res, 200, { project: store.project(project.repo.id) }); return true
      }
      if (path === '/api/commit/admin/reports/resolve') {
        payouts.requireAdmin(req)
        if (input.status !== 'resolved' && input.status !== 'dismissed') throw new HttpError(400, 'Choose resolved or dismissed.')
        if (typeof input.note !== 'string' || input.note.length > 1000) throw new HttpError(400, 'Use a note of at most 1,000 characters.')
        const report = store.updateReport(String(input.id), input.status, input.note.trim()); if (!report) throw new HttpError(404, 'Report not found.')
        store.audit(session.user.id, `report.${input.status}`, report.repositoryId, { id: report.id }); reply(res, 200, { report }); return true
      }
      if (path === '/api/commit/admin/projects/visibility') {
        // Delisting hides a coin from Commit's listings. The token stays onchain and its fees stay claimable.
        payouts.requireAdmin(req)
        const project = store.project(Number(input.repositoryId)); if (!project) throw new HttpError(404, 'Project not found.')
        if (typeof input.hidden !== 'boolean') throw new HttpError(400, 'Choose whether to delist or relist.')
        if (input.hidden && (typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 300)) throw new HttpError(400, 'Give a public delisting reason (5–300 characters).')
        store.updateProject(project.repo.id, p => { if (input.hidden) p.hidden = { at: new Date().toISOString(), reason: String(input.reason).trim() }; else delete p.hidden })
        store.audit(session.user.id, input.hidden ? 'project.delisted' : 'project.relisted', project.repo.id, { reason: input.reason ?? '' }); invalidate()
        reply(res, 200, { project: store.project(project.repo.id) }); return true
      }
      if (path === '/api/commit/payouts/request') {
        await syncProjects()
        const project = store.project(Number(input.repositoryId)); if (!project) throw new HttpError(404, 'Project not found.')
        const request = await payouts.request(req, project, input)
        if (!store.eligibility(project.repo.id).some(item => item.userId === session.user.id && item.approved)) { store.markClaimed(project.repo.id, session.user.login); invalidate() }
        alerts.send(`New payout request: ${Number(request.amount) / 10 ** (project.coin.quote?.decimals ?? 8)} ${project.coin.quote?.symbol || ''} for ${project.repo.owner}/${project.repo.name} by @${request.login}. Review: ${origin}/admin/payouts`)
        reply(res, 201, { request }); return true
      }
      if (path === '/api/commit/payouts/cancel') { reply(res, 200, { request: payouts.ledger.cancel(String(input.id), session.user.id) }); return true }
      if (path === '/api/commit/payouts/decide') {
        payouts.requireAdmin(req)
        if (input.action !== 'approve' && input.action !== 'reject') throw new HttpError(400, 'Choose approve or reject.')
        if (typeof input.note !== 'string' || input.note.length > 1000 || (input.action === 'reject' && input.note.trim().length < 5)) throw new HttpError(400, 'Provide a reason for rejection (5–1,000 characters).')
        reply(res, 200, { request: payouts.ledger.decide(String(input.id), session.user.id, input.action, input.note.trim()) }); return true
      }
      if (path === '/api/commit/payouts/settle') { reply(res, 200, { request: await payouts.settle(req, String(input.id), input.signature) }); return true }
      if (path === '/api/commit/repositories/verify') {
        // { id } from the maintainer's own list, or { repository: 'owner/name' | GitHub URL } for any public repository
        const { repo, maintainer } = await github.launchable(input.repository !== undefined ? String(input.repository) : Number(input.id), session.token)
        const existing = store.project(repo.id)
        if (existing) throw new HttpError(409, `${repo.owner}/${repo.name} already has a token on Commit: /${existing.repo.owner}/${existing.repo.name}`)
        reply(res, 200, { repo, maintainer, launch: maintainer ? 'maintainer' : 'community', development: await development(repo, session.token) }); return true
      }
      if (path === '/api/commit/wallet/challenge') { reply(res, 200, contributors.challenge(session.user, String(input.wallet))); return true }
      if (path === '/api/commit/wallet/verify') { reply(res, 200, contributors.verify(session.user, String(input.id), String(input.signature))); return true }
      if (path === '/api/commit/settings' || path === '/api/commit/contributors/approve') {
        const project = store.project(Number(input.repositoryId)); if (!project) throw new HttpError(404, 'Project not found.')
        const current = await github.verify(project.repo.id, session.token, { forClaims: true })
        if (path.endsWith('/settings')) {
          if (!categories.includes(input.category as Category)) throw new HttpError(400, 'Choose a valid category.')
          const allocations = validateAllocations(input.allocations)
          store.settings(project.repo.id, input.category as Category, allocations)
          store.audit(session.user.id, 'project.settings', project.repo.id, { category: input.category, allocations }); invalidate()
        } else {
          if (typeof input.login !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(input.login)) throw new HttpError(400, 'Enter a GitHub username.')
          if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 1000 || typeof input.approved !== 'boolean') throw new HttpError(400, 'Provide an approval decision and a substantive contribution rationale.')
          const prefix = `${current.url}/` // the repository's current URL, even after a rename
          if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 10 || input.evidence.some(v => typeof v !== 'string' || v.length > 300 || !v.startsWith(prefix) || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+(#[-\w]+)?$/.test(v))) throw new HttpError(400, 'Attach 1–10 pull request or issue URLs from this repository.')
          const { data: contributor } = await github.get<{ id: number; login: string }>(`/users/${input.login}`, session.token)
          store.approve(project.repo.id, { userId: contributor.id, login: contributor.login, approved: input.approved, reason: input.reason.trim(), evidence: input.evidence as string[], approvedBy: session.user.id, updatedAt: new Date().toISOString(), wallet: null })
          store.audit(session.user.id, 'contributor.eligibility', project.repo.id, { userId: contributor.id, approved: input.approved, evidence: input.evidence })
        }
        reply(res, 200, { ok: true }); return true
      }
      throw new HttpError(404, 'Endpoint not found.')
    } catch (error) { reply(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Request failed. Retry shortly; existing transaction records are preserved.' }); return true }
    finally { active--; const count = (clients.get(ip) || 1) - 1; if (count) clients.set(ip, count); else clients.delete(ip) }
  }
  let cursor = 0, refreshing = false
  return { handler, pump, store, payouts, async refresh() {
    if (refreshing) return
    refreshing = true
    try {
    store.cleanup(); await pump.refresh()
    const projects = await syncProjects()
    for (let i = 0; i < Math.min(projects.length, 3); i++) {
      const project = projects[(cursor + i) % projects.length]
      await sample(project).catch(() => {})
      await development(project.repo).catch(() => {})
    }
    cursor = projects.length ? (cursor + 3) % projects.length : 0
    } finally { refreshing = false }
  } }
}
