import { useState, type ReactNode } from 'react'
import { reportReasons, reportRelationships } from '../lib/types'
import { request, errorText } from './api'
import { Link, Notice } from './components'

const UPDATED = 'September 29, 2026'
function Page({ eyebrow, title, intro, children, dated = true }: { eyebrow: string; title: string; intro: ReactNode; children: ReactNode; dated?: boolean }) {
  return <section className="container legal-page"><div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{intro}</p>{dated && <p className="mono small muted">Last updated {UPDATED}</p>}</div><div className="legal-body">{children}</div></section>
}

export function Terms() {
  return <Page eyebrow="commit / terms" title="Terms of use." intro="Plain-language terms for using commitpad.fun. By launching, trading, or requesting a payout, you agree to them.">
    <h2>1. What Commit is</h2><p>Commit is an independent interface for launching and trading Pump.fun tokens linked to public GitHub repositories. Tokens are created and traded on Solana through Pump.fun. Commit never holds your wallet or keys: every transaction is signed in your own wallet.</p>
    <h2>2. No affiliation or endorsement</h2><p>Commit is not affiliated with, endorsed by, or sponsored by GitHub, Pump.fun, Microsoft, or the owners of any repository shown here. A listing on Commit is not an endorsement by Commit.</p>
    <h2>3. Community launches</h2><p>Anyone signed in with GitHub can launch a coin for any active public repository, one coin per repository. If the launcher doesn’t maintain the repository, the coin is labelled a <b>community launch</b>, shows the launcher’s GitHub username, and states that the repository’s maintainers did not create or endorse it. Creator fees are reserved for the repository’s maintainers and the contributors they approve, never for a launcher who is neither.</p>
    <h2>4. Your responsibilities when launching</h2><p>You are responsible for the name, ticker, image, and description you publish; they become permanent, public token metadata. Don’t use a coin to impersonate a person or project, imply an endorsement that doesn’t exist, use names or logos misleadingly, or mislead buyers in any other way.</p>
    <h2>5. Fees and payouts</h2><p>Each coin pays a 2% creator fee through Pump.fun to Commit’s collection wallet, tracked per coin in a treasury ledger. Pump.fun’s own protocol fees are separate. Eligible GitHub users request payouts, and Commit reviews each request and sends it manually. Payouts are not automatic. They may be delayed, limited to verified amounts, or refused when eligibility can’t be verified, fee indexing is incomplete, or fraud is suspected.</p>
    <h2>6. Listings and takedowns</h2><p>We may hide (“delist”) any coin from Commit’s pages at our discretion, including after a report from a project or rights holder. Delisting can’t remove a token from the blockchain or stop trading elsewhere. A delisted coin’s fees stay claimable by the repository’s maintainers. To report a coin, use <Link to="/report">the report form</Link>.</p>
    <h2>7. No advice, no guarantees</h2><p>Nothing on Commit is financial, investment, legal, or tax advice. Tokens can lose all of their value; read <Link to="/risk">the risks</Link>. Commit is provided “as is”, without warranties. Data from GitHub, Pump.fun, and other indexes can be delayed or wrong.</p>
    <h2>8. Limitation of liability</h2><p>To the extent the law allows, Commit and its operators are not liable for losses from trading, smart-contract, network, or wallet failures, third-party services, or listing decisions.</p>
    <h2>9. Eligibility</h2><p>Only use Commit where it is legal for you to do so. Don’t use it if you are in a jurisdiction, or on a sanctions list, where this activity is prohibited.</p>
    <h2>10. Changes and contact</h2><p>We may update these terms; the date above changes when we do. Contact <a href="https://x.com/commitpadfun" target="_blank" rel="noreferrer">@commitpadfun on X</a>, or use <Link to="/report">the report form</Link>.</p>
  </Page>
}

export function Privacy() {
  return <Page eyebrow="commit / privacy" title="Privacy." intro="What Commit stores, why, and what is public.">
    <h2>GitHub sign-in</h2><p>When you sign in we receive your GitHub user ID, username, and avatar, plus an access token with the <code>read:user public_repo read:org</code> scopes. The token is stored encrypted (AES-256-GCM) and used only to read repository permissions; Commit never writes to GitHub. Sessions expire after eight hours.</p>
    <h2>Wallets</h2><p>If you verify a payout wallet, we store its public address linked to your GitHub ID. We never see private keys. Wallet addresses, launches, trades, and payouts are public on the Solana blockchain.</p>
    <h2>What is shown publicly</h2><p>The launcher’s GitHub username on community-launched coins, and the username of a maintainer who claims a coin (“claimed by”) or requests a payout from it. Payout requests are visible only to you and the payout operator.</p>
    <h2>Reports</h2><p>Details and contact information sent through the report form are used only to review the report.</p>
    <h2>Records and logs</h2><p>We keep audit records of launches, contributor approvals, payouts, and reports. IP addresses are used in memory for rate limiting. Commit has no third-party analytics or advertising trackers, and doesn’t sell data.</p>
    <h2>Deletion</h2><p>Ask through <Link to="/report">the report form</Link> or <a href="https://x.com/commitpadfun" target="_blank" rel="noreferrer">@commitpadfun</a> to remove your wallet link or account data. Onchain data can’t be deleted.</p>
  </Page>
}

export function Risk() {
  return <Page eyebrow="commit / risks" title="Know the risks." intro="Coins on Commit are speculative. Read this before you launch, buy, or sell.">
    <h2>You can lose everything</h2><p>Coins trade on a Pump.fun bonding curve and then PumpSwap. Prices can fall to zero, liquidity can be thin, and trades are final. Only use money you can afford to lose.</p>
    <h2>Names don’t mean endorsement</h2><p>Anyone can launch a coin for any public repository. A coin named after a project, labelled a community launch, was not created or endorsed by that project’s maintainers. Even a maintainer launch is not a promise of future work or value.</p>
    <h2>Fees are claimed, not streamed</h2><p>Creator fees are tracked per coin and paid out manually after review, only to GitHub-verified maintainers and the contributors they approve. The ledger is accounting, not an escrow; the collection wallet holds fees for every coin.</p>
    <h2>Priced in a tokenized stock</h2><p>New coins are paired with Microsoft xStock (MSFTx), a token that tracks Microsoft stock under its issuer’s terms. Its price moves with the stock, and you need SOL for network fees.</p>
    <h2>Software and third parties fail</h2><p>Pump.fun, Solana, wallets, GitHub, and indexers can fail, be exploited, or change. Commit can’t reverse onchain transactions.</p>
    <h2>Laws and taxes</h2><p>Rules for tokens differ by country and change. You are responsible for following them and for any taxes.</p>
  </Page>
}

export function Report() {
  const [form, setForm] = useState({ target: new URLSearchParams(location.search).get('coin') || '', reason: 'impersonation', relationship: 'maintainer', details: '', contact: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('')
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  async function submit() { setBusy(true); setError(''); try { const value = await request<{ id: string }>('/api/commit/reports', form); setDone(value.id) } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <Page dated={false} eyebrow="commit / report" title="Report a coin." intro="Tell us about a coin that impersonates a project, misuses a name or logo, or misleads buyers. No account needed.">
    {done ? <Notice>Report received (reference {done.slice(0, 8)}). We review every report and may delist the coin from Commit. Onchain tokens can’t be deleted, but a delisted coin disappears from Commit’s pages.</Notice> :
    <form className="form-panel report-form" onSubmit={e => { e.preventDefault(); void submit() }}><fieldset disabled={busy}>
      <label>Coin<input required maxLength={300} value={form.target} onChange={set('target')} placeholder="commitpad.fun/owner/repo, owner/repo, or the token mint"/></label>
      <div className="form-row"><label>Reason<select value={form.reason} onChange={set('reason')}>{reportReasons.map(r => <option key={r} value={r}>{r}</option>)}</select></label><label>You are<select value={form.relationship} onChange={set('relationship')}>{reportRelationships.map(r => <option key={r} value={r}>{r === 'holder' ? 'a coin holder' : r === 'owner' ? 'the repository owner' : r === 'maintainer' ? 'a maintainer' : 'other'}</option>)}</select></label></div>
      <label>What’s wrong<textarea required minLength={20} maxLength={2000} rows={5} value={form.details} onChange={set('details')} placeholder="What the coin claims, why it is misleading, and any links that help us verify you."/></label>
      <label>How to reach you<input required maxLength={200} value={form.contact} onChange={set('contact')} placeholder="Email, or your X / GitHub handle"/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="button primary">{busy ? 'Sending…' : 'Send report'}</button>
    </fieldset></form>}
  </Page>
}
