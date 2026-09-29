import { useEffect, useState } from 'react'
import { ArrowUpRight, Github, Menu, Search, Wallet, X } from 'lucide-react'
import { api, ApiError, explorerUrl, readRecovery, recoveryStorageKey, short, storeRecovery, useSolanaWallet, type Plan, type Recovery } from '../packages/pump-core/client'
import type { Project, User } from '../lib/types'
import { request, errorText } from './api'
import { AppContext } from './context'
import { Brand, Link, Modal, X_URL, XLogo } from './components'
import { Home, Explore } from './Explore'
import { Create } from './Create'
import { ProjectPage } from './Project'
import { Dashboard, DashboardIndex } from './Dashboard'
import { Account } from './Account'
import { MarketStrip } from './MarketStrip'
import { PayoutAdmin } from './PayoutAdmin'
import { Payouts } from './Payouts'
import { Unclaimed } from './Unclaimed'
import { Privacy, Report, Risk, Terms } from './Legal'

/** Route on the pathname without trailing slashes (the server serves `/explore/` too). */
const route = (pathname: string) => pathname.replace(/\/+$/, '') || '/'

export default function App() {
  const wallet = useSolanaWallet(), [walletOpen, setWalletOpen] = useState(false), [menu, setMenu] = useState(false)
  const [path, setPath] = useState(route(location.pathname)), [search, setSearch] = useState(location.search), [user, setUser] = useState<User | null>(null), [githubConfigured, setConfigured] = useState(false)
  const [payoutAdmin, setPayoutAdmin] = useState(false), [sessionLoaded, setSessionLoaded] = useState(false)
  const [pending, setPending] = useState<Recovery | null>(readRecovery), [activity, setActivity] = useState<Plan | null>(null), [error, setError] = useState(''), [missing, setMissing] = useState(false), [resending, setResending] = useState(false)
  function navigate(next: string) {
    // Routing matches the pathname only; the query (e.g. /report?coin=…) and hash are kept in the URL.
    const url = new URL(next, location.origin), target = url.pathname + url.search + url.hash
    if (target !== location.pathname + location.search + location.hash) history.pushState(null, '', target)
    setPath(route(url.pathname)); setSearch(url.search); setMenu(false)
    if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView()); else window.scrollTo(0, 0)
  }
  async function refreshSession() { try { const value = await request<{ user: User | null; githubConfigured: boolean; payoutAdmin?: boolean }>('/api/commit/session'); setUser(value.user); setConfigured(value.githubConfigured); setPayoutAdmin(value.payoutAdmin === true) } finally { setSessionLoaded(true) } }
  useEffect(() => { void refreshSession().catch(e => setError(errorText(e))); const pop = () => { setPath(route(location.pathname)); setSearch(location.search); setMenu(false) }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [])
  useEffect(() => { document.title = `${path === '/' ? 'Fund the code.' : path === '/create' ? 'Launch repository' : path === '/explore' ? 'Explore projects' : path.slice(1).replaceAll('/', ' / ')} · Commit` }, [path])
  useEffect(() => {
    // ⌘/Ctrl-K opens search, but never while typing: leaving a half-filled launch form would lose it.
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !(event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); if (route(location.pathname) !== '/explore') navigate('/explore'); requestAnimationFrame(() => document.getElementById('project-search')?.focus()) } }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => { const sync = (event: StorageEvent) => { if (!event.key || event.key === recoveryStorageKey) { setPending(readRecovery()); setActivity(null) } }; window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync) }, [])
  useEffect(() => {
    setMissing(false)
    if (!pending || pending.invalid) return
    let alive = true, running = false
    const check = async () => {
      if (running) return; running = true
      try {
        const value = await api<Plan>(`status/${pending.id}`)
        if (!alive) return
        if (value.owner !== pending.owner || value.mint !== pending.mint || value.signature && value.signature !== pending.signature) throw Error('Saved transaction does not match its server record.')
        setActivity({ ...value, signature: value.signature || pending.signature })
        if (value.status === 'confirmed') {
          if (!value.kind) {
            const { items } = await request<{ items: Project[] }>('/api/commit/projects')
            if (!alive) return
            const project = items.find(item => item.coin.mint === value.mint)
            if (!project) throw Error('Transaction finalized; repository publication is retrying.')
            navigate(`/${project.repo.owner}/${project.repo.name}`)
          }
          storeRecovery(null, pending.id); setPending(readRecovery()); setError('')
        }
      } catch (e) { if (alive) { setMissing(e instanceof ApiError && e.status === 404); setError(errorText(e)) } }
      finally { running = false }
    }
    void check(); const timer = setInterval(check, 6000); return () => { alive = false; clearInterval(timer) }
  }, [pending?.id])
  function dismiss() { try { storeRecovery(null, pending?.id); setPending(readRecovery()); setActivity(null); setError('') } catch (e) { setError(errorText(e)) } }
  async function retry() { if (!pending || pending.invalid) return; setResending(true); try { setActivity(await api<Plan>('submit', { id: pending.id, transaction: pending.signed, networkFeeLamports: pending.networkFeeLamports })) } catch (e) { setError(errorText(e)) } finally { setResending(false) } }
  const projectMatch = /^\/([^/]+)\/([^/]+)$/.exec(path), dashboardMatch = /^\/dashboard\/([^/]+)\/([^/]+)$/.exec(path)
  return <AppContext.Provider value={{ wallet, user, githubConfigured, payoutAdmin, sessionLoaded, refreshSession, navigate, connect: () => setWalletOpen(true), pending, activity, onPending: (record, plan) => { setPending(record); setActivity(plan) }, onActivity: setActivity }}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`site-header ${path === '/' ? 'home-header' : ''}`}><div className="header-inner">
      <Brand/>
      <nav id="primary-navigation" aria-label="Main navigation" className={menu ? 'main-nav open' : 'main-nav'}><Link to="/explore" className={path === '/explore' ? 'active' : ''}>Explore</Link><Link to="/create" className={path === '/create' ? 'active' : ''}><span className="nav-long">Launch a repository</span><span className="nav-short">Launch</span></Link><Link to="/dashboard" className={path.startsWith('/dashboard') ? 'active' : ''}>Dashboard</Link><Link to="/payouts" className={path === '/payouts' || path === '/admin/payouts' ? 'active' : ''}>Payouts</Link></nav>
      <div className="header-actions"><Link to="/explore" className="nav-search" ariaLabel="Search projects"><Search size={16}/><kbd>⌘ K</kbd></Link><a className="nav-x" href={X_URL} target="_blank" rel="noreferrer" aria-label="Commitpad on X (@commitpadfun)" title="@commitpadfun on X"><XLogo size={15}/></a><button className="wallet-button" aria-label={wallet.account ? `Wallet ${short(wallet.account.address)}` : 'Connect wallet'} onClick={() => setWalletOpen(true)}><Wallet size={15}/><span>{wallet.account ? short(wallet.account.address) : 'Connect wallet'}</span></button>{user ? <Link to="/account" className="account-button" ariaLabel={`${user.login} account`}><img src={user.avatar} alt=""/><span>{user.login}</span></Link> : <a className="button header-signin" href={`/api/auth/login?next=${encodeURIComponent(path)}`}><Github size={15}/><span>Sign in</span></a>}<button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-controls="primary-navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20}/> : <Menu size={20}/>}</button></div>
    </div></header>
    <MarketStrip path={path}/>
    <main id="main">
      {error && <div className="container"><p role="alert" className="error">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></p></div>}
      {pending && <section className="transaction-banner container"><div className="eyebrow">TRANSACTION RECOVERY</div><h3>{pending.invalid ? 'Saved transaction needs attention' : activity?.status === 'failed' ? 'Transaction failed' : activity?.status === 'expired' ? 'Transaction expired' : 'Waiting for Solana finality'}</h3><p>{pending.invalid ? 'Browser recovery storage is damaged or unavailable. Check your wallet activity before clearing it.' : activity?.error || 'The signed transaction is saved. Reloading this page will resume confirmation.'}</p>{pending.signature && <a href={explorerUrl(pending.signature)} target="_blank" rel="noreferrer">View transaction<ArrowUpRight size={14}/></a>}{!pending.invalid && !missing && !['failed', 'expired'].includes(activity?.status || '') && <button disabled={resending} className="button secondary" onClick={() => void retry()}>{resending ? 'Resending…' : 'Retry same signed transaction'}</button>}{(pending.invalid || missing || ['failed', 'expired'].includes(activity?.status || '')) && <button className="button secondary" onClick={dismiss}>Clear after checking wallet activity</button>}</section>}
      {path === '/' ? <Home/> : path === '/explore' ? <Explore/> : path === '/create' ? <Create/> : path === '/account' ? <Account/> : path === '/dashboard' ? <DashboardIndex/> : path === '/admin/payouts' ? <PayoutAdmin/> : path === '/payouts' ? <Payouts/> : path === '/unclaimed' ? <Unclaimed/> : path === '/terms' ? <Terms/> : path === '/privacy' ? <Privacy/> : path === '/risk' ? <Risk/> : path === '/report' ? <Report key={search}/> : dashboardMatch ? <Dashboard key={path} owner={dashboardMatch[1]} name={dashboardMatch[2]}/> : projectMatch ? <ProjectPage key={path} owner={projectMatch[1]} name={projectMatch[2]}/> : <section className="container page-heading"><h1>Nothing committed here.</h1><Link to="/explore" className="button dark">Explore projects</Link></section>}
    </main>
    <footer className="site-footer"><div className="container"><div className="footer-top"><div><Brand/><p>fund the code. settled on solana.</p></div><nav className="footer-links" aria-label="Footer navigation"><Link to="/explore">markets ↗</Link><Link to="/create">launch ↗</Link><Link to="/dashboard">dashboard ↗</Link><a href="https://pump.fun" target="_blank" rel="noreferrer">pump.fun ↗</a><a href="https://pawnspad.fun" target="_blank" rel="noreferrer">pawns ↗</a><a href={X_URL} target="_blank" rel="noreferrer" aria-label="Commitpad on X (@commitpadfun)">x / @commitpadfun ↗</a></nav></div><div className="footer-bottom"><span>© {new Date().getFullYear()} commit</span><nav className="footer-legal" aria-label="Legal and support"><Link to="/terms">terms</Link><Link to="/privacy">privacy</Link><Link to="/risk">risks</Link><Link to="/report">report a coin</Link><Link to="/unclaimed">unclaimed fees</Link></nav><span><i className="status-dot"/>mainnet</span></div></div></footer>
    {walletOpen && <Modal title={wallet.account ? 'Connected wallet' : 'Connect Solana wallet'} close={() => setWalletOpen(false)}><div className="wallet-options">{wallet.account ? <><code>{wallet.account.address}</code><button className="button secondary" onClick={() => void wallet.disconnect().then(() => setWalletOpen(false)).catch(e => setError(errorText(e)))}>Disconnect</button></> : wallet.wallets.length ? wallet.wallets.map(item => <button className="button secondary" key={item.name} onClick={() => void wallet.connect(item).then(() => setWalletOpen(false)).catch(e => setError(errorText(e)))}><img src={item.icon} width="24" height="24" alt=""/>{item.name}</button>) : <><p>Open Commit in a compatible wallet browser, or install a Solana Wallet Standard wallet.</p><a className="button dark" href="https://phantom.com" target="_blank" rel="noreferrer">Get Phantom<ArrowUpRight size={16}/></a><a className="button secondary" href="https://solflare.com" target="_blank" rel="noreferrer">Get Solflare<ArrowUpRight size={16}/></a></>}<p className="muted small">Your wallet signs every transaction. Commit never receives your wallet’s private keys.</p></div></Modal>}
  </AppContext.Provider>
}
