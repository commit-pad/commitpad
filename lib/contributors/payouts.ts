import { randomUUID } from 'node:crypto'
import bs58 from 'bs58'
import type { IncomingMessage } from 'node:http'
import { assetAmount, HttpError } from '../../packages/pump-core/server'
import type { Auth } from '../github/auth'
import type { GitHub } from '../github/api'
import type { Store } from '../repositories/store'
import type { CoinFeeStats } from '../../packages/pump-core/client'
import type { PayoutRequest, Project, TreasurySummary, User } from '../types'
import { COMMIT_FEE_RECIPIENT, MICROSOFT_ASSET } from '../pump/policy'
import { SOL_ASSET } from '../../packages/pump-core/client'

const columns = `id,repo_id AS repositoryId,user_id AS userId,login,wallet,quote_mint AS quoteMint,amount,status,note,decision_note AS decisionNote,created_at AS createdAt,updated_at AS updatedAt,decided_by AS decidedBy,signature,paid_at AS paidAt`
export function createPayoutLedger(store: Store) {
  const db = store.db
  function atomic<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value } catch (e) { db.exec('ROLLBACK'); throw e } }
  function get(id: string) { return db.prepare(`SELECT ${columns} FROM payout_requests WHERE id=?`).get(id) as PayoutRequest | undefined }
  function totals(repo: number) {
    const rows = db.prepare("SELECT amount,status FROM payout_requests WHERE repo_id=? AND status IN ('paid','pending','approved')").all(repo) as { amount: string; status: string }[]
    return { paid: rows.filter(r => r.status === 'paid').reduce((n, r) => n + BigInt(r.amount), 0n), reserved: rows.filter(r => r.status !== 'paid').reduce((n, r) => n + BigInt(r.amount), 0n) }
  }
  return {
    get, totals,
    list(repo?: number, userId?: number) { return db.prepare(`SELECT ${columns} FROM payout_requests WHERE (? IS NULL OR repo_id=?) AND (? IS NULL OR user_id=?) ORDER BY created_at DESC LIMIT 200`).all(repo ?? null, repo ?? null, userId ?? null, userId ?? null) as PayoutRequest[] },
    queue(status: string, page = 1) { return db.prepare(`SELECT ${columns} FROM payout_requests WHERE status=? ORDER BY created_at ASC LIMIT 100 OFFSET ?`).all(status, (page - 1) * 100) as PayoutRequest[] },
    request(project: Project, user: User, wallet: string, amount: bigint, earned: bigint, note: string) {
      return atomic(() => {
        if (amount <= 0n) throw new HttpError(400, 'Request an amount greater than zero.')
        if (db.prepare("SELECT id FROM payout_requests WHERE repo_id=? AND user_id=? AND status IN ('pending','approved')").get(project.repo.id, user.id)) throw new HttpError(409, 'You already have a pending or approved request for this coin.')
        const balance = totals(project.repo.id)
        if (amount > earned - balance.paid - balance.reserved) throw new HttpError(409, 'The requested amount exceeds this coin’s unreserved verified earnings. Refresh the treasury.')
        const id = randomUUID(), now = Date.now()
        db.prepare(`INSERT INTO payout_requests(id,repo_id,user_id,login,wallet,quote_mint,amount,status,note,created_at,updated_at,earned_snapshot) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?)`).run(id, project.repo.id, user.id, user.login, wallet, project.coin.quote!.mint, amount.toString(), note, now, now, earned.toString())
        store.audit(user.id, 'payout.requested', project.repo.id, { id, wallet, amount: amount.toString(), quoteMint: project.coin.quote!.mint })
        return get(id)!
      })
    },
    cancel(id: string, userId: number) {
      return atomic(() => { const row = get(id); if (!row || row.userId !== userId) throw new HttpError(404, 'Payout request not found.'); if (row.status !== 'pending') throw new HttpError(409, 'Only a pending request can be cancelled. Approved payouts are locked for manual settlement.'); db.prepare("UPDATE payout_requests SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(), id); store.audit(userId, 'payout.cancelled', row.repositoryId, { id }); return get(id)! })
    },
    decide(id: string, actor: number, action: 'approve' | 'reject', note: string) {
      return atomic(() => { const row = get(id); if (!row) throw new HttpError(404, 'Payout request not found.'); if (row.status !== 'pending') throw new HttpError(409, 'This request is no longer pending.'); db.prepare('UPDATE payout_requests SET status=?,decision_note=?,decided_by=?,updated_at=? WHERE id=?').run(action === 'approve' ? 'approved' : 'rejected', note, actor, Date.now(), id); store.audit(actor, `payout.${action}`, row.repositoryId, { id, note }); return get(id)! })
    },
    paid(id: string, actor: number, signature: string, paidAt: number) {
      return atomic(() => { const row = get(id); if (!row) throw new HttpError(404, 'Payout request not found.'); if (row.status === 'paid' && row.signature === signature) return row; if (row.status !== 'approved') throw new HttpError(409, 'Approve the request before recording a manual payout.'); if (db.prepare('SELECT id FROM payout_requests WHERE signature=?').get(signature)) throw new HttpError(409, 'This transaction has already been used for a payout. Use one transfer transaction per request.'); db.prepare("UPDATE payout_requests SET status='paid',signature=?,paid_at=?,decided_by=?,updated_at=? WHERE id=?").run(signature, paidAt, actor, Date.now(), id); store.audit(actor, 'payout.paid', row.repositoryId, { id, signature, amount: row.amount, wallet: row.wallet }); return get(id)! })
    },
  }
}

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
export type PayoutReceipt = { blockTime: number | null; transaction: { signatures: string[]; message: { accountKeys: { pubkey: string; signer: boolean }[] } }; meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null }
export function validatePayoutReceipt(receipt: PayoutReceipt | null, request: PayoutRequest, signature: string, collector = COMMIT_FEE_RECIPIENT) {
  if (!receipt?.meta || receipt.meta.err || receipt.transaction.signatures[0] !== signature || !receipt.blockTime || receipt.blockTime * 1000 < request.createdAt - 60000) throw new HttpError(400, 'A successful finalized transfer after this request is required.')
  if (!receipt.transaction.message.accountKeys.some(key => key.pubkey === collector && key.signer)) throw new HttpError(400, 'The manual payout must be signed by the designated collection wallet.')
  const before = receipt.meta.preTokenBalances, after = receipt.meta.postTokenBalances
  if (!before || !after) throw new HttpError(400, 'Token-balance proof is unavailable for this transaction.')
  const total = (rows: TokenBalance[], owner: string) => rows.filter(r => r.mint === request.quoteMint && r.owner === owner).reduce((n, r) => {
    if (r.uiTokenAmount.decimals !== MICROSOFT_ASSET.decimals || !/^\d+$/.test(r.uiTokenAmount.amount)) throw new HttpError(400, 'Invalid payout asset amounts.')
    return n + BigInt(r.uiTokenAmount.amount)
  }, 0n)
  const received = total(after, request.wallet) - total(before, request.wallet), spent = total(before, collector) - total(after, collector)
  if (received !== BigInt(request.amount) || spent < BigInt(request.amount) || request.quoteMint !== MICROSOFT_ASSET.mint || request.wallet === collector) throw new HttpError(400, 'Transfer recipient, Microsoft asset, or exact requested amount does not match. Send one payout per transaction.')
  return receipt.blockTime * 1000
}

export function createPayouts(store: Store, auth: Auth, github: GitHub, fees: (mint: string) => Promise<CoinFeeStats>, receipt: (signature: string) => Promise<PayoutReceipt | null>) {
  const ledger = createPayoutLedger(store)
  const configured = (process.env.COMMIT_PAYOUT_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (configured.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw Error('COMMIT_PAYOUT_ADMIN_IDS must contain GitHub numeric account IDs.')
  const admins = new Set(configured.map(Number))
  const isAdmin = (user?: User | null) => !!user && admins.has(user.id)
  function requireAdmin(req: IncomingMessage) { const session = auth.requireSession(req); if (!isAdmin(session.user)) throw new HttpError(403, 'Only a configured Commit payout operator can manage requests.'); return session }
  const fresh = (value: CoinFeeStats) => value.status === 'complete' && value.amount !== null && /^\d+$/.test(value.amount) && !!value.updatedAt && Date.now() - value.updatedAt >= 0 && Date.now() - value.updatedAt <= 300000
  async function eligibility(req: IncomingMessage, project: Project) {
    const session = auth.session(req), slug = `${project.repo.owner}/${project.repo.name}`
    if (!session) return { allowed: false, reason: `Maintainers of ${slug} can claim these fees. Sign in with GitHub to claim.` }
    // Who may claim comes first (approved contributor, or live GitHub admin/maintain permission), then the wallet.
    if (!store.eligibility(project.repo.id).some(item => item.userId === session.user.id && item.approved)) {
      try { await github.verify(project.repo.id, session.token, { forClaims: true }) }
      catch (e) { if (e instanceof HttpError && e.status === 403) return { allowed: false, reason: `Only maintainers of ${slug}, and contributors they approve, can claim these fees.` }; throw e }
    }
    const wallet = store.wallet(session.user.id)
    if (!wallet) return { allowed: false, reason: 'Verify a payout wallet in Account settings first.' }
    if (wallet === project.treasury) return { allowed: false, reason: 'Link a payout wallet different from the fee-collection wallet.' }
    return { allowed: true, reason: '' }
  }
  return {
    ledger, isAdmin, requireAdmin,
    async summary(req: IncomingMessage, project: Project): Promise<TreasurySummary> {
      const value = await fees(project.coin.mint), balance = ledger.totals(project.repo.id), session = auth.session(req)
      const access = project.fundingMode === 'manual-v1' ? await eligibility(req, project) : { allowed: false, reason: project.main ? 'Creator fees for Commit’s main coin go directly to its creator wallet through Pump.fun.' : 'This launch uses direct treasury collection, not the manual payout program.' }
      const available = fresh(value) ? BigInt(value.amount!) - balance.paid - balance.reserved : null
      const requests = session ? ledger.list(project.repo.id, session.user.id) : [], hasOpen = requests.some(r => r.status === 'pending' || r.status === 'approved')
      return { repositoryId: project.repo.id, collector: project.treasury, quote: project.coin.quote || SOL_ASSET, fees: value, paid: balance.paid.toString(), reserved: balance.reserved.toString(), available: available === null ? null : (available < 0n ? 0n : available).toString(), canRequest: access.allowed && !hasOpen && available !== null && available > 0n, reason: access.reason || (hasOpen ? 'Your open request is awaiting review or manual payment.' : available === null ? 'Waiting for fresh, complete per-coin fee indexing.' : available <= 0n ? 'No unreserved earnings are available for this coin yet.' : ''), wallet: session ? store.wallet(session.user.id) || null : null, requests, fundingMode: project.fundingMode || 'direct' }
    },
    async request(req: IncomingMessage, project: Project, input: Record<string, unknown>) {
      const session = auth.requireSession(req)
      if (project.fundingMode !== 'manual-v1' || project.coin.quote?.mint !== MICROSOFT_ASSET.mint || project.coin.feeRecipient !== COMMIT_FEE_RECIPIENT) throw new HttpError(400, 'This coin is not part of the manual Microsoft-fee payout program.')
      const access = await eligibility(req, project)
      if (!access.allowed) throw new HttpError(403, access.reason)
      const wallet = store.wallet(session.user.id)!
      let amount: bigint
      try { amount = assetAmount(input.amount, project.coin.quote.decimals) } catch { throw new HttpError(400, 'Enter an MSFTx amount with at most 8 decimal places.') }
      if (typeof input.note !== 'string' || input.note.length > 1000) throw new HttpError(400, 'Use a request note of at most 1,000 characters.')
      const value = await fees(project.coin.mint)
      if (!fresh(value)) throw new HttpError(409, 'Wait for fresh, complete fee indexing before requesting a payout.')
      if (wallet !== store.wallet(session.user.id) || wallet === COMMIT_FEE_RECIPIENT) throw new HttpError(409, 'The payout wallet changed. Review the destination and try again.')
      return ledger.request(project, session.user, wallet, amount, BigInt(value.amount!), input.note.trim())
    },
    async settle(req: IncomingMessage, id: string, signature: unknown) {
      const session = requireAdmin(req), row = ledger.get(id)
      if (!row) throw new HttpError(404, 'Payout request not found.')
      if (typeof signature !== 'string' || signature.length > 90) throw new HttpError(400, 'Enter the Solana transfer transaction signature.')
      try { if (bs58.decode(signature).length !== 64) throw Error() } catch { throw new HttpError(400, 'Invalid Solana transaction signature.') }
      if (row.status === 'paid' && row.signature === signature) return row
      if (row.status !== 'approved') throw new HttpError(409, 'Approve the request before sending a manual payout.')
      const paidAt = validatePayoutReceipt(await receipt(signature), row, signature)
      return ledger.paid(id, session.user.id, signature, paidAt)
    },
  }
}
