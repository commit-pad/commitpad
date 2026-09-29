import { useEffect, useState } from 'react'
import type { AdminPayout, PayoutStatus, Project, Report } from '../lib/types'
import { explorerUrl, formatUnits, type FeeBalances } from '../packages/pump-core/client'
import { useApp } from './context'
import { request, errorText } from './api'
import { Empty, External, Link, Notice } from './components'

export function PayoutAdmin() {
  const app = useApp(), [status, setStatus] = useState<PayoutStatus>('pending'), [items, setItems] = useState<AdminPayout[]>([]), [page, setPage] = useState(1), [next, setNext] = useState<number | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [collection, setCollection] = useState<FeeBalances | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({}), [signatures, setSignatures] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!app.payoutAdmin) return; let alive = true
    void request<{ items: AdminPayout[]; next: number | null }>(`/api/commit/payouts/admin?status=${status}&page=${page}`).then(value => { if (alive) { setItems(value.items); setNext(value.next) } }).catch(e => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [app.payoutAdmin, status, page, revision])
  async function act(row: AdminPayout, action: 'approve' | 'reject' | 'paid') {
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'paid') await request('/api/commit/payouts/settle', { id: row.id, signature: (signatures[row.id] || '').trim() })
      else await request('/api/commit/payouts/decide', { id: row.id, action, note: notes[row.id] || '' })
      setNotice(action === 'paid' ? 'Finalized transfer verified. The request is paid and the coin ledger is updated.' : action === 'approve' ? 'Request approved and locked for manual settlement. Send the payout yourself, then record its signature under Approved.' : 'Request rejected. Its reservation is released.')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false); setRevision(n => n + 1) }
  }
  async function loadCollection() { setBusy(true); setError(''); try { setCollection(await request<FeeBalances>('/api/commit/payouts/collection')) } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  if (!app.sessionLoaded) return <section className="container page-heading"><Empty title="Loading">Checking your session…</Empty></section>
  if (!app.payoutAdmin) return <section className="container page-heading"><Empty title="Payout operator access required">{app.user ? 'This account is not configured as a Commit payout operator.' : <a href={`/api/auth/login?next=${encodeURIComponent(location.pathname)}`} className="button primary">Sign in with GitHub</a>}</Empty></section>
  return <section className="container payout-admin"><div className="page-heading"><div className="eyebrow">commit operator / manual settlements</div><h1>Payout requests.</h1><p>Review each coin’s requests. Send approved payouts manually, then verify the finalized transfer here.</p></div>
    <div className="form-panel operator-tools"><div className="eyebrow">operator tools / all coins</div><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => void loadCollection()}>Read collection balances</button><External href="https://pump.fun">Collect creator fees on Pump.fun</External></div>{collection && <><p className="small muted">Network balance: {formatUnits(collection.walletSol, 9)} SOL. Vault balances include every coin, not one project.</p><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Curve vault</th><th>PumpSwap vault</th><th>Total claimable</th></tr></thead><tbody>{collection.balances.map(b => <tr key={b.quote.mint}><td>{b.quote.symbol}</td><td>{formatUnits(b.curve, b.quote.decimals)}</td><td>{formatUnits(b.pool, b.quote.decimals)}</td><td>{formatUnits(b.total, b.quote.decimals)}</td></tr>)}</tbody></table></div></>}</div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <Notice>{notice}</Notice>}
    <div className="filter-bar" aria-label="Payout status">{(['pending', 'approved', 'paid', 'rejected', 'cancelled'] as const).map(value => <button key={value} className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); setItems([]); setError(''); setNotice('') }}>{value}</button>)}<button onClick={() => setRevision(n => n + 1)}>Refresh</button></div>
    <div className="payout-queue">{items.map(row => <article key={row.id} className="form-panel"><div className="payout-row-heading"><div><Link to={`/${row.repository}`} className="text-link">{row.repository}</Link><p className="small muted">${row.symbol} · requested by <External href={`https://github.com/${row.login}`}>{row.login}</External> · {new Date(row.createdAt).toLocaleString()}</p></div><strong>{formatUnits(row.amount, row.quote.decimals)} {row.quote.symbol}</strong></div><label>Verified destination · locked at request<code className="wallet-address">{row.wallet}</code></label>{row.note && <p className="payout-note">{row.note}</p>}{row.decisionNote && <Notice>{row.decisionNote}</Notice>}
      {row.status === 'pending' && <fieldset disabled={busy}><label>Decision note<textarea rows={2} maxLength={1000} value={notes[row.id] || ''} onChange={e => setNotes({ ...notes, [row.id]: e.target.value })} placeholder="Required when rejecting a request"/></label><div className="button-row"><button className="button primary" onClick={() => void act(row, 'approve')}>Approve for manual payout</button><button className="button secondary" onClick={() => void act(row, 'reject')}>Reject request</button></div></fieldset>}
      {row.status === 'approved' && <fieldset disabled={busy}><Notice>Send exactly {formatUnits(row.amount, row.quote.decimals)} {row.quote.symbol} from the collection wallet to the locked destination above. Use one transaction per request. Approval does not send funds.</Notice><label>Manual transfer transaction signature<input value={signatures[row.id] || ''} onChange={e => setSignatures({ ...signatures, [row.id]: e.target.value })} placeholder="Paste the Solana transaction signature after sending" autoComplete="off"/></label><button className="button primary" onClick={() => void act(row, 'paid')}>Verify transfer & mark paid</button></fieldset>}
      {row.signature && <External href={explorerUrl(row.signature)}>Verified payout transaction</External>}
    </article>)}</div>{!items.length && <Empty title={`No ${status} payout requests`}>Requests appear here when eligible GitHub users submit a claim from a project treasury.</Empty>}
    <div className="market-results-footer"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span className="mono">page {page}</span><button className="button secondary" disabled={!next} onClick={() => { if (next) setPage(next) }}>Next</button></div>
    <Reports/>
  </section>
}

type AdminReport = Report & { project: Project | null }
/** Coin reports and delisting. Delisting hides a coin from Commit; it stays onchain and its fees stay claimable. */
function Reports() {
  const [status, setStatus] = useState<Report['status']>('open'), [items, setItems] = useState<AdminReport[]>([]), [revision, setRevision] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { let alive = true; void request<{ items: AdminReport[] }>(`/api/commit/admin/reports?status=${status}`).then(v => { if (alive) { setItems(v.items); if (location.hash === '#reports') requestAnimationFrame(() => document.getElementById('reports')?.scrollIntoView()) } }).catch(e => { if (alive) setError(errorText(e)) }); return () => { alive = false } }, [status, revision])
  async function act(fn: () => Promise<unknown>, message: string) { setBusy(true); setError(''); setNotice(''); try { await fn(); setNotice(message) } catch (e) { setError(errorText(e)) } finally { setBusy(false); setRevision(n => n + 1) } }
  const resolve = (row: AdminReport, next: 'resolved' | 'dismissed') => act(() => request('/api/commit/admin/reports/resolve', { id: row.id, status: next, note: notes[row.id] || '' }), `Report ${next}.`)
  const visibility = (row: AdminReport, hidden: boolean) => act(() => request('/api/commit/admin/projects/visibility', { repositoryId: row.repositoryId, hidden, reason: notes[row.id] || '' }), hidden ? 'Coin delisted from Commit. It stays onchain and its fees stay claimable.' : 'Coin relisted.')
  return <section id="reports" className="admin-reports"><div className="section-heading"><div><div className="eyebrow">operator / reports</div><h2>Coin reports.</h2></div></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <Notice>{notice}</Notice>}
    <div className="filter-bar" aria-label="Report status">{(['open', 'resolved', 'dismissed'] as const).map(value => <button key={value} className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => { setStatus(value); setItems([]) }}>{value}</button>)}<button onClick={() => setRevision(n => n + 1)}>Refresh</button></div>
    <div className="payout-queue">{items.map(row => <article key={row.id} className="form-panel"><div className="payout-row-heading"><div>{row.project ? <Link to={`/${row.project.repo.owner}/${row.project.repo.name}`} className="text-link">{row.project.repo.owner}/{row.project.repo.name}</Link> : <span className="mono">{row.target}</span>}<p className="small muted">{row.reason} · from {row.relationship} · {row.contact} · {new Date(row.createdAt).toLocaleString()}{row.project?.hidden && ' · delisted'}</p></div><strong>{row.status}</strong></div><p className="payout-note">{row.details}</p>{row.note && <Notice>{row.note}</Notice>}
      <fieldset disabled={busy}><label>Note / public delisting reason<textarea rows={2} maxLength={300} value={notes[row.id] || ''} onChange={e => setNotes({ ...notes, [row.id]: e.target.value })} placeholder="Required to delist: 5–300 characters, shown on the coin page"/></label><div className="button-row">{row.project && (row.project.hidden ? <button className="button secondary" onClick={() => void visibility(row, false)}>Relist coin</button> : <button className="button primary" onClick={() => void visibility(row, true)}>Delist coin</button>)}{row.status === 'open' && <><button className="button secondary" onClick={() => void resolve(row, 'resolved')}>Mark resolved</button><button className="button secondary" onClick={() => void resolve(row, 'dismissed')}>Dismiss</button></>}</div></fieldset>
    </article>)}</div>{!items.length && <Empty title={`No ${status} reports`}>Reports from /report appear here.</Empty>}
  </section>
}
