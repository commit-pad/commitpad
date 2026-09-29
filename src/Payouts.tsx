import { useEffect, useState } from 'react'
import { ArrowUpRight, Github } from 'lucide-react'
import { explorerUrl, formatUnits } from '../packages/pump-core/client'
import type { MyPayout } from '../lib/types'
import { useApp } from './context'
import { request, errorText } from './api'
import { Empty, External, LaunchBadge, Link, Notice } from './components'

// One place to claim: every coin tied to a repository the signed-in GitHub user maintains
// (whether they launched it or someone else did), plus coins where they are an approved contributor.
export function Payouts() {
  const app = useApp(), [items, setItems] = useState<MyPayout[] | null>(null), [wallet, setWallet] = useState<string | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!app.user) return; let alive = true
    setError('')
    void request<{ items: MyPayout[]; wallet: string | null }>('/api/commit/payouts/mine').then(value => { if (alive) { setItems(value.items); setWallet(value.wallet) } }).catch(e => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [app.user?.id, app.user?.wallet, revision])
  const heading = <div className="page-heading"><div className="eyebrow">payouts / your github</div><h1>Request your payout.</h1><p>Connect your GitHub. Commit finds every coin tied to a repository you maintain, whether you launched it or someone else did, and shows the fees you can claim.</p></div>
  if (!app.sessionLoaded) return <section className="container payouts-page">{heading}<Empty title="Loading">Checking your GitHub session…</Empty></section>
  if (!app.user) return <section className="container payouts-page">{heading}<div className="form-panel payouts-connect"><Github size={30}/><h2>Connect your GitHub for the payout.</h2><p className="muted">Creator fees follow the repository, not the launcher. Maintainers, and contributors they approve, claim here.</p><a href="/api/auth/login?next=/payouts" className="button dark"><Github size={16}/>Connect GitHub<ArrowUpRight size={16}/></a></div></section>
  // Totals are kept per paired asset (never adding MSFTx to SOL), and only manual-payout coins count as requestable.
  const total = (pick: (item: MyPayout) => string | null | undefined, only?: (item: MyPayout) => boolean) => {
    const rows = (items || []).filter(item => !only || only(item))
    if (rows.some(item => pick(item) == null)) return 'Indexing…'
    const byAsset = new Map<string, { symbol: string; decimals: number; sum: bigint }>()
    for (const item of rows) { const q = item.treasury.quote, entry = byAsset.get(q.mint) || { symbol: q.symbol, decimals: q.decimals, sum: 0n }; entry.sum += BigInt(pick(item) || '0'); byAsset.set(q.mint, entry) }
    return byAsset.size ? [...byAsset.values()].map(t => `${formatUnits(t.sum.toString(), t.decimals)} ${t.symbol}`).join(' · ') : '0'
  }
  return <section className="container payouts-page">{heading}
    <p className="small payouts-links"><Link to="/unclaimed" className="text-link">unclaimed coins<ArrowUpRight size={13}/></Link>{app.payoutAdmin && <Link to="/admin/payouts" className="text-link">operator: payout requests &amp; reports<ArrowUpRight size={13}/></Link>}</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <Notice>{notice}</Notice>}
    {!wallet && items !== null && <Notice>Verify a payout wallet before requesting: sign one message in <Link to="/account">Account</Link>. It authorizes no transaction.</Notice>}
    {items === null && !error ? <Empty title="Finding your coins">Checking which repositories you maintain on GitHub…</Empty> : items?.length ? <>
      <div className="treasury-grid payouts-totals">{([['Fees earned · all coins', total(i => i.treasury.fees.amount)], ['Paid out · all claimants', total(i => i.treasury.paid)], ['Coins', String(items.length)], ['Available to request', total(i => i.treasury.available, i => i.treasury.fundingMode === 'manual-v1')]] as const).map(([label, value]) => <div key={label}><span className="eyebrow">{label}</span><strong>{value}</strong></div>)}</div>
      <div className="payout-queue">{items.map(item => <PayoutCoin key={item.project.repo.id} item={item} wallet={wallet} onDone={message => { setNotice(message); setRevision(n => n + 1) }}/>)}</div>
    </> : error ? <p><button className="button secondary" onClick={() => setRevision(n => n + 1)}>Retry</button></p> : <Empty title="No coins to claim yet">None of the repositories you maintain has a coin on Commit, and no maintainer has approved you as a contributor. <Link to="/create">Launch one</Link> for your repository, or anyone can launch one for you.</Empty>}
  </section>
}

function PayoutCoin({ item, wallet, onDone }: { item: MyPayout; wallet: string | null; onDone: (message: string) => void }) {
  const { project, role, treasury } = item, { repo, coin } = project
  const [open, setOpen] = useState(false), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (!treasury.canRequest) setOpen(false) }, [treasury.canRequest])
  const unit = treasury.quote.symbol, decimals = treasury.quote.decimals
  const display = (value?: string | null) => value == null ? 'Indexing…' : `${formatUnits(value, decimals)} ${unit}`
  async function submit() {
    setBusy(true); setError('')
    try { await request('/api/commit/payouts/request', { repositoryId: repo.id, amount, note }); setOpen(false); setAmount(''); setNote(''); onDone(`Payout request received for ${repo.owner}/${repo.name}. No funds have moved yet; Commit reviews it and sends the payout manually.`) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function claim() {
    setBusy(true); setError('')
    try { await request('/api/commit/claim', { repositoryId: repo.id }); onDone(`You claimed ${repo.owner}/${repo.name}. Its page now shows that a maintainer is here.`) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function cancel(id: string) {
    setBusy(true); setError('')
    try { await request('/api/commit/payouts/cancel', { id }); onDone('Pending request cancelled. Its reservation has been released.') }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <article className="form-panel payout-coin">
    <div className="payout-row-heading"><div><Link to={`/${repo.owner}/${repo.name}`} className="text-link">{repo.owner} / {repo.name}<ArrowUpRight size={13}/></Link><p className="small muted">${coin.symbol} · you are {role === 'maintainer' ? 'a maintainer' : 'an approved contributor'} · <LaunchBadge project={project}/>{project.launch === 'community' && project.launchedBy && <> by @{project.launchedBy}</>}</p></div><strong>{display(treasury.available)}</strong></div>
    <div className="treasury-grid">{([['Fees earned', treasury.fees.amount], ['Paid · verified', treasury.paid], ['Reserved · open requests', treasury.reserved], ['Available to request', treasury.available]] as const).map(([label, value]) => <div key={label}><span className="eyebrow">{label}</span><strong>{display(value)}</strong></div>)}</div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="treasury-claim-actions"><button className="button primary" disabled={!open && (!treasury.canRequest || busy)} onClick={() => setOpen(!open)}>{open ? 'Close request' : 'Request payout'}</button>{role === 'maintainer' && project.launch === 'community' && !project.claimedAt && <button className="button secondary" disabled={busy} onClick={() => void claim()} title="Publicly mark this coin as claimed by you, a maintainer. It doesn't endorse the launch.">Claim this coin</button>}{treasury.reason && <span className="small muted">{treasury.reason}</span>}</div>
    {open && <form onSubmit={e => { e.preventDefault(); void submit() }}><fieldset disabled={busy}><label>Amount · {unit}<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/></label><button type="button" className="inline-button" onClick={() => setAmount(formatUnits(treasury.available || '0', decimals))}>Use available amount</button><label>Paid to your verified wallet<code className="wallet-address">{wallet}</code></label><label>Note <span className="muted">(optional)</span><textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Milestone, contribution, or context"/></label><button type="submit" className="button primary">{busy ? 'Submitting…' : 'Submit payout request'}</button></fieldset></form>}
    {treasury.requests.length > 0 && <div className="table-scroll"><table><thead><tr><th>Your requests</th><th>Amount</th><th>Status</th><th>Receipt / action</th></tr></thead><tbody>{treasury.requests.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleDateString()}{row.decisionNote && <small className="payout-note">{row.decisionNote}</small>}</td><td>{display(row.amount)}</td><td><span className={`payout-status ${row.status}`}>{row.status}</span></td><td>{row.signature ? <External href={explorerUrl(row.signature)}>Verified transfer</External> : row.status === 'pending' ? <button disabled={busy} className="inline-button" onClick={() => void cancel(row.id)}>Cancel request</button> : row.status === 'approved' ? 'Awaiting manual transfer' : '—'}</td></tr>)}</tbody></table></div>}
  </article>
}
