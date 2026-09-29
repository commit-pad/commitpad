import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Code2, GitBranch, Github, LayoutGrid, List, Plus, Search, ShieldCheck, Star, X } from 'lucide-react'
import { categories, type Project } from '../lib/types'
import { Empty, Link, ProjectCard, number, MainPin } from './components'
import { usdNumber, usdValue } from '../packages/pump-core/client'
import { useProjects } from './useProjects'

export function Home() {
  const projects = useProjects()
  return <>
    <section className="hero-stage container"><div className="hero">
      <div className="hero-copy"><div className="eyebrow">github / solana / independent launchpad</div><h1 aria-label="Fund the code.">fund the<br/><span>code.</span></h1><h2>Open-source software can fund itself.</h2><p>Launch any public GitHub repository through Pump.fun.<br/>Its maintainers claim the creator revenue.</p><div className="hero-buttons"><Link to="/create" className="button primary">Launch Repository<ArrowUpRight size={14}/></Link><Link to="/explore" className="button secondary">Explore Projects<ArrowRight size={14}/></Link></div><div className="hero-footnote"><ShieldCheck size={12}/>maintainers verified at the source. signed in your wallet.</div></div>
      <div className="source-terminal"><div className="source-terminal-bar"><span><GitBranch size={13}/>main / commit.config</span><span>readme</span></div><div className="source-code" aria-label="GitHub repository, Microsoft-paired Pump.fun market, and a manual payout ledger"><div><span>01</span><code><i>// a funding layer for open source</i></code></div><div><span>02</span><code>const project = {'{'}</code></div><div><span>03</span><code>  source: <b>"github/your-repo"</b>,</code></div><div><span>04</span><code>  pair: <b>"Microsoft / MSFTx"</b>,</code></div><div><span>05</span><code>  payouts: <b>"manual requests"</b>,</code></div><div><span>06</span><code>{'};'}</code></div></div><div className="source-terminal-summary"><span>creator fee / per-coin treasury ledger</span><strong>2%</strong></div><div className="source-terminal-foot"><Github size={13}/><span>any public repository is a starting point.</span><Code2 size={15}/></div></div>
    </div><div className="hero-baseline"><a href="#market"><ArrowDown size={12}/>browse repository markets</a><span>powered by pawns <span>/</span> launched through pump.fun</span></div></section>
    <section id="market" className="container homepage-projects">
      <div className="section-heading"><div><div className="eyebrow">01 / repository markets</div><h2>code worth backing.</h2></div><Link to="/explore" className="text-link">all projects<ArrowUpRight size={13}/></Link></div>
      <ProjectMarket {...projects} compact/>
    </section>
    <section className="how-section" id="how-it-works"><div className="container">
      <div className="section-heading"><div><div className="eyebrow">02 / the workflow</div><h2>commit. launch. build.</h2></div><p>One repository. One coin.<br/>Fees go to the people shipping it.</p></div>
      <div className="how-grid">{([
        ['01', 'repository', 'Sign in with GitHub and choose any public repository, yours or someone else’s.'],
        ['02', 'token', 'Configure a token that’s directly connected to your project.'],
        ['03', 'treasury', 'Microsoft-paired launches with a 2% creator fee. Each coin gets its own earnings and manual-payout ledger.'],
        ['04', 'build', 'Maintainers claim the fees, approve contributors, and ship the next release.'],
      ] as const).map(([n, title, text]) => <article key={n}><div className="how-card-top"><span>{n}</span><ArrowUpRight size={13}/></div><h3>{title}</h3><p>{text}</p></article>)}</div>
    </div></section>
    <section className="builder-section container"><div className="builder-copy"><div className="eyebrow">03 / built around builders</div><h2>the code is<br/>the thesis.</h2><p>There’s a repository behind every token. A person behind every pull request. And a project worth paying attention to.</p><Link to="/create" className="text-link">put your project on commit<ArrowUpRight size={13}/></Link></div><div className="builder-features">
      <article><span className="feature-icon"><Github size={22}/></span><div><h3>Claims verified at the source.</h3><p>Anyone can launch a public repository, but only maintainers GitHub confirms, and contributors they approve, can claim its fees. Community launches are labelled.</p></div><span className="mono">01</span></article>
      <article><span className="feature-icon"><GitBranch size={22}/></span><div><h3>More than a price chart.</h3><p>See merged pull requests, releases, and contributors alongside real market activity.</p></div><span className="mono">02</span></article>
      <article><span className="feature-icon"><ShieldCheck size={22}/></span><div><h3>Reward the people doing the work.</h3><p>Maintainers approve contributor eligibility using meaningful work, not a gameable commit counter.</p></div><span className="mono">03</span></article>
    </div></section>
    <section className="closing-section container"><div><span className="eyebrow">open source deserves an economy.</span><h2>make your next commit.</h2></div><Link to="/create" className="button primary">Launch Repository<ArrowUpRight size={14}/></Link></section>
  </>
}

function ProjectTable({ items }: { items: Project[] }) {
  return <div className="table-scroll project-table"><table><thead><tr><th>Repository</th><th>Token</th><th>Market cap</th><th>24h volume</th><th>Stars</th><th>Creator revenue</th><th>Market</th></tr></thead><tbody>{items.map(({ repo, coin, discovery, launch }) => <tr key={repo.id}>
    <td><Link to={`/${repo.owner}/${repo.name}`} className="table-project"><img src={coin.image || repo.avatar} alt=""/><span><strong>{repo.name}{launch !== 'community' && <Check size={12}/>}</strong><small>{repo.owner} / {repo.language || 'Open source'}</small></span><ArrowUpRight size={14}/></Link></td><td>${coin.symbol}<small className="paired-label">/ {coin.quote?.symbol || '—'}</small></td><td>{usdNumber(usdValue(coin.market?.fdv, coin.market?.usdReference))}</td><td>{usdNumber(discovery?.volume24h)}</td><td><Star size={12}/>{number(repo.stars)}</td><td>{number(discovery?.revenue)} {coin.quote?.symbol || '—'}</td><td><span className="market-state">{coin.market?.complete ? 'PumpSwap' : 'Bonding curve'}</span></td>
  </tr>)}</tbody></table></div>
}

function ProjectMarket({ items, loading, error, compact = false }: { items: Project[]; loading: boolean; error: string; compact?: boolean }) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState('Trending'), [category, setCategory] = useState('All projects'), [limit, setLimit] = useState(compact ? 6 : 24), [view, setViewState] = useState<'grid' | 'list'>(() => { try { const saved = !compact && sessionStorage.getItem('commit.explore.view'); return saved === 'grid' || saved === 'list' ? saved : compact ? 'grid' : 'list' } catch { return compact ? 'grid' : 'list' } })
  // Remembered for this tab, so coming Back from a coin page keeps the chosen layout.
  const setView = (value: 'grid' | 'list') => { setViewState(value); if (!compact) try { sessionStorage.setItem('commit.explore.view', value) } catch { /* storage unavailable */ } }
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => setLimit(compact ? 6 : 24), [query, sort, category, compact])
  useEffect(() => {
    const focus = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); search.current?.focus() } }
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus)
  }, [compact])
  function order(a: Project, b: Project) {
    if (sort === 'Most Stars') return b.repo.stars - a.repo.stars
    if (sort === 'Most Contributors') return (b.discovery?.contributors ?? -1) - (a.discovery?.contributors ?? -1)
    if (sort === 'Volume') return (b.discovery?.volume24h ?? -1) - (a.discovery?.volume24h ?? -1)
    if (sort === 'Creator Revenue') return (usdValue(b.discovery?.revenue, b.coin.market?.usdReference) ?? -1) - (usdValue(a.discovery?.revenue, a.coin.market?.usdReference) ?? -1)
    if (sort === 'Development Activity') return Date.parse(b.repo.updatedAt) - Date.parse(a.repo.updatedAt)
    if (sort === 'Market Cap') return (b.coin.market?.fdv || 0) * (b.coin.market?.usdReference?.price || 0) - (a.coin.market?.fdv || 0) * (a.coin.market?.usdReference?.price || 0)
    if (sort === 'Trending') return (b.coin.market?.progress || 0) - (a.coin.market?.progress || 0) || b.repo.stars - a.repo.stars
    return b.coin.createdAt - a.coin.createdAt
  }
  // The main coin is pinned first whatever the sort.
  const shown = useMemo(() => items.filter(p => (category === 'All projects' || p.category === category) && `${p.repo.owner}/${p.repo.name} ${p.coin.symbol} ${p.coin.mint}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(!!b.main) - Number(!!a.main) || order(a, b)), [items, category, query, sort])
  const main = items.find(p => p.main)
  return <div className="market-browser">
    {main && <MainPin project={main}/>}
    <div className="explore-tools"><label className="search"><Search size={18}/><input ref={search} id={compact ? 'home-project-search' : 'project-search'} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search repository, ticker or mint" aria-label="Search repository, ticker or mint"/>{query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button> : <kbd>/</kbd>}</label><div className="view-toggle" role="group" aria-label="Project view"><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17}/></button><button aria-label="Table view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18}/></button></div>{!compact && <Link className="button dark" to="/create"><Plus size={16}/>Launch repository</Link>}</div>
    <div className="filter-bar" role="group" aria-label="Sort projects">{['Trending', 'Newest', 'Most Stars', 'Most Contributors', 'Development Activity', 'Market Cap', 'Volume', 'Creator Revenue'].map(item => <button key={item} aria-pressed={sort === item} className={sort === item ? 'active' : ''} onClick={() => setSort(item)}>{item === 'Trending' && <span className="status-dot"/>}{item}</button>)}</div>
    <div className="category-bar"><div className="category-chips" role="group" aria-label="Project categories">{['All projects', ...categories].map(item => <button key={item} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div><span className="result-count mono">{number(shown.length)} PROJECTS</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <Empty title="Reading the repository index">Loading finalized launches…</Empty> : shown.length ? <>{view === 'grid' ? <div className="project-grid">{shown.slice(0, limit).map(project => <ProjectCard key={project.repo.id} project={project}/>)}</div> : <ProjectTable items={shown.slice(0, limit)}/>}<div className="market-results-footer"><span className="mono">{Math.min(limit, shown.length)} of {shown.length} projects</span>{shown.length > limit && <button className="button secondary" onClick={() => setLimit(limit + 24)}>Load more projects<ArrowDown size={14}/></button>}</div></> : query || category !== 'All projects' ? <Empty title="No repositories match your search.">Try another repository, ticker, or category. <button className="inline-button" onClick={() => { setQuery(''); setCategory('All projects') }}>Reset filters</button></Empty> : <div className="market-empty"><span className="empty-terminal-marker" aria-hidden="true">[+]</span><div><div className="eyebrow">repository index / awaiting first launch</div><h3>every economy starts with a commit.</h3><p>Launch the first coin for any public GitHub repository.<br/>Only finalized project tokens appear in this market.</p><Link to="/create" className="text-link">launch your repository<ArrowUpRight size={13}/></Link></div><span className="empty-index mono">0 / finalized</span></div>}
    <div className="market-data-note"><ShieldCheck size={13}/><span>New launches pair with Microsoft xStock at a 2% creator fee (Commit’s own main coin is SOL-paired). Market cap and volume are in USD; revenue is shown in the paired asset and ranked by its available USD reference. Trending ranks curve progress, then stars.</span></div>
  </div>
}

export function Explore() {
  const projects = useProjects()
  return <section className="container explore-page"><div className="explore-page-heading"><div><div className="eyebrow">github / usd / repository tokens</div><h1>repository markets.</h1><p>Read the code. Follow the market. Back the builders.</p></div><div className="explore-counter"><span className="status-dot"/><span className="mono">{projects.loading ? 'reading index' : `${number(projects.items.length)} ${projects.items.length === 1 ? 'project' : 'projects'}`}</span></div></div><ProjectMarket {...projects}/></section>
}
