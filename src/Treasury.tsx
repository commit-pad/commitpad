import { useEffect, useState } from 'react'
import { formatUnits, explorerUrl } from '../packages/pump-core/client'
import type { TreasurySummary } from '../lib/types'
import { request, errorText } from './api'
import { useApp } from './context'
import { External, Link, Notice } from './components'

export function ProjectTreasury({ repositoryId }: { repositoryId: number }) {
  const app = useApp(), [data, setData] = useState<TreasurySummary | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [amount, setAmount] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [open, setOpen] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true, running = false
    const load = async () => { if (running) return; running = true; try { const value = await request<TreasurySummary>(`/api/commit/project/${repositoryId}/treasury`); if (alive) { setData(value); setLoadError('') } } catch (e) { if (alive) setLoadError(errorText(e)) } finally { running = false } }
    void load(); const timer = setInterval(load, 20000); return () => { alive = false; clearInterval(timer) }
  }, [repositoryId, app.user?.id, app.user?.wallet, revision])
  useEffect(() => { if (data && !data.canRequest) setOpen(false) }, [data?.canRequest])
  const unit = data?.quote.symbol || 'MSFTx', decimals = data?.quote.decimals ?? 8
  const display = (value?: string | null) => value == null ? 'Indexing…' : `${formatUnits(value, decimals)} ${unit}`
  const stats: [string, string | null | undefined][] = [['Fees earned', data?.fees.amount], ['Paid · verified transfers', data?.paid], ['Reserved · open requests', data?.reserved], ['Available to request', data?.available]]
  async function submit() {
    setBusy(true); setError(''); setNotice('')
    try { await request('/api/commit/payouts/request', { repositoryId, amount, note }); setNotice('Claim request received. No funds have moved. Commit will review your request and send the payout manually.'); setOpen(false); setAmount(''); setNote('') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false); setRevision(n => n + 1) }
  }
  async function cancel(id: string) {
    setBusy(true); setError('')
    try { await request('/api/commit/payouts/cancel', { id }); setNotice('Pending request cancelled. Its reservation has been released.') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false); setRevision(n => n + 1) }
  }
  return <section className="payout-treasury" aria-label="Per-coin treasury"><div className="section-heading"><div><div className="eyebrow">project treasury / per-coin ledger</div><h2>Fees earned. Builders paid.</h2></div><button className="button secondary" onClick={() => setRevision(n => n + 1)}>Refresh</button></div>
    {(error || loadError) && <p role="alert" className="error">{error || loadError}</p>}{notice && <Notice>{notice}</Notice>}
    <div className="treasury-grid">{stats.map(([label, value]) => <div key={label}><span className="eyebrow">{label}</span><strong>{display(value)}</strong></div>)}</div>
    <p className="data-note">This is this coin’s accounting ledger, not the shared wallet balance or an onchain escrow. Earned totals include already-collected protocol fees. {data?.fees.status !== 'complete' && 'The last verified total may be shown while indexing catches up.'} {data?.fees.notice}</p>
    {data?.fundingMode === 'manual-v1' && <><p className="small muted">Creator fees are collected by Commit. Claims are payout requests, reviewed and sent manually in {unit}. Approved requests remain reserved until a finalized transfer is verified.</p><div className="treasury-claim-actions">{!app.user ? <a href={`/api/auth/login?next=${encodeURIComponent(location.pathname)}`} className="button primary">Connect GitHub to claim</a> : <><button className="button primary" disabled={!open && (!data.canRequest || busy)} onClick={() => setOpen(!open)}>{open ? 'Close request' : 'Claim / request payout'}</button>{!data.wallet && <Link to="/account" className="button secondary">Verify payout wallet</Link>}<Link to="/payouts" className="text-link">all your payouts</Link></>}<span className="small muted">{data.reason}</span></div></>}
    {data?.fundingMode === 'direct' && <Notice>{data.reason} <External href={`https://solscan.io/account/${data.collector}`}>View treasury wallet</External></Notice>}
    {open && data && <form className="form-panel" onSubmit={e => { e.preventDefault(); void submit() }}><h3>Request a manual payout</h3><fieldset disabled={busy}><label>Amount · {unit}<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/></label><button type="button" className="inline-button" onClick={() => setAmount(formatUnits(data.available || '0', decimals))}>Use available amount</button><label>Verified payout wallet<code className="wallet-address">{data.wallet}</code></label><label>Request note <span className="muted">(optional)</span><textarea rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Contribution, milestone, or funding context"/></label><Notice>Submitting records a request and reserves the amount. It does not sign a transaction, collect Pump.fun fees, or send funds. Your verified wallet is saved with this request.</Notice><button type="submit" className="button primary">{busy ? 'Submitting request…' : 'Submit claim request'}</button></fieldset></form>}
    {app.user && <div className="table-scroll"><table><thead><tr><th>Your requests</th><th>Amount</th><th>Status</th><th>Wallet</th><th>Receipt / action</th></tr></thead><tbody>{data?.requests.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleDateString()}{row.decisionNote && <small className="payout-note">{row.decisionNote}</small>}</td><td>{display(row.amount)}</td><td><span className={`payout-status ${row.status}`}>{row.status}</span></td><td title={row.wallet}>{row.wallet.slice(0, 5)}…{row.wallet.slice(-5)}</td><td>{row.signature ? <External href={explorerUrl(row.signature)}>Verified transfer</External> : row.status === 'pending' ? <button disabled={busy} className="inline-button" onClick={() => void cancel(row.id)}>Cancel request</button> : row.status === 'approved' ? 'Awaiting manual transfer' : '—'}</td></tr>)}</tbody></table>{!data?.requests.length && <p className="table-empty">You have no payout requests for this coin.</p>}</div>}
  </section>
}
