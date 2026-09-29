import { ArrowUpRight, Github } from 'lucide-react'
import { useProjects } from './useProjects'
import { Empty, Link, number } from './components'

// Community-launched coins no maintainer has claimed yet: a page to point maintainers at.
export function Unclaimed() {
  const { items, loading, error } = useProjects()
  const unclaimed = items.filter(p => p.launch === 'community' && !p.claimedAt).sort((a, b) => (b.discovery?.revenue ?? 0) - (a.discovery?.revenue ?? 0))
  return <section className="container unclaimed-page"><div className="page-heading"><div className="eyebrow">payouts / unclaimed</div><h1>Unclaimed fees.</h1><p>These coins were launched by the community for repositories whose maintainers haven’t claimed them yet. Maintain one? Connect GitHub and the fees are yours to request. Know a maintainer? Send them this page.</p></div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <Empty title="Reading the repository index">Loading community launches…</Empty> : unclaimed.length ? <div className="table-scroll"><table><thead><tr><th>Repository</th><th>Coin</th><th>Launched by</th><th>Fees earned</th><th/></tr></thead><tbody>{unclaimed.map(({ repo, coin, launchedBy, discovery }) => <tr key={repo.id}>
      <td><Link to={`/${repo.owner}/${repo.name}`} className="table-project"><img src={coin.image || repo.avatar} alt=""/><span><strong>{repo.name}</strong><small>{repo.owner}{repo.forked ? ' · fork' : ''}</small></span></Link></td>
      <td>${coin.symbol}</td><td>@{launchedBy || '—'}</td><td>{discovery?.revenue == null ? 'Indexing…' : `${number(discovery.revenue)} ${coin.quote?.symbol || ''}`}</td>
      <td><a className="text-link" href="/api/auth/login?next=/payouts"><Github size={13}/>maintainer? claim<ArrowUpRight size={13}/></a></td>
    </tr>)}</tbody></table></div> : <Empty title="Nothing unclaimed">Every community-launched coin has been claimed by a maintainer. <Link to="/explore">Explore projects</Link>.</Empty>}
  </section>
}
