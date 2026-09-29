import { useState } from 'react'
import type { WalletAccount } from '@wallet-standard/base'
import { Github, ShieldCheck } from 'lucide-react'
import { b64 } from '../packages/pump-core/client'
import { useApp } from './context'
import { errorText, request } from './api'
import { Notice } from './components'
export function Account() {
  const app = useApp(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false)
  async function link() {
    if (!app.wallet.account || !app.wallet.selected) { app.connect(); return }
    const account = app.wallet.account, feature = app.wallet.selected.features['solana:signMessage'] as { signMessage: (...inputs: { account: WalletAccount; message: Uint8Array }[]) => Promise<{ signature: Uint8Array; signedMessage: Uint8Array }[]> } | undefined
    if (!feature) { setError('This wallet does not support message signatures. Connect a wallet with solana:signMessage support.'); return }
    setBusy(true); setError('')
    try {
      const challenge = await request<{ id: string; message: string }>('/api/commit/wallet/challenge', { wallet: account.address })
      const signed = await feature.signMessage({ account, message: new TextEncoder().encode(challenge.message) })
      if (!signed[0]?.signature) throw Error('Wallet did not return a message signature.')
      await request('/api/commit/wallet/verify', { id: challenge.id, signature: b64(signed[0].signature) })
      await app.refreshSession(); setDone(true)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <section className="container account-page"><div className="page-heading"><div className="eyebrow">BUILDER IDENTITY</div><h1>Your <span className="serif">account.</span></h1><p>One verified GitHub identity. Your own Solana wallet.</p></div><div className="form-panel">{error && <p className="error" role="alert">{error}</p>}{!app.sessionLoaded ? <p className="muted">Checking your GitHub session…</p> : app.user ? <><div className="account-profile"><img src={app.user.avatar} alt=""/><div><h2>{app.user.login}</h2><span className="mono small">GitHub ID {app.user.id}</span></div><ShieldCheck size={24}/></div><h3>Contributor wallet</h3><p className="muted">Sign a single-use message to prove wallet ownership. Project admins can approve your contribution eligibility independently.</p>{app.user.wallet && <code className="wallet-address">{app.user.wallet}</code>}{done && <Notice>Wallet ownership verified and saved.</Notice>}<button disabled={busy} className="button dark" onClick={() => void link()}>{busy ? 'Verify in wallet…' : app.user.wallet ? 'Update linked wallet' : 'Verify and link wallet'}</button><hr/><button className="button secondary" onClick={() => void request('/api/auth/logout', {}).then(() => app.refreshSession()).catch(e => setError(errorText(e)))}>Sign out of GitHub</button></> : <><Github size={30}/><h2>Connect your GitHub account.</h2><a href={`/api/auth/login?next=${encodeURIComponent(location.pathname)}`} className="button dark">Sign in with GitHub</a></>}</div></section>
}
