import { GitBranch } from 'lucide-react'
import { useProjects } from './useProjects'
import { Link } from './components'
import { usdNumber, usdValue } from '../packages/pump-core/client'

export function MarketStrip({ path }: { path: string }) {
  const { items, loading, error } = useProjects()
  return <div className="market-strip"><div className="container market-strip-inner">
    <span className="strip-label"><GitBranch size={13}/>repository markets</span>
    <div className="strip-projects" aria-label="Repository market overview">
      {items.length ? items.slice(0, 12).map(project => <Link key={project.repo.id} to={`/${project.repo.owner}/${project.repo.name}`} className={path === `/${project.repo.owner}/${project.repo.name}` ? 'strip-project active' : 'strip-project'}>{project.main && <em className="strip-main">main</em>}<strong>${project.coin.symbol}</strong><span>{project.repo.owner}/{project.repo.name}</span><b>{usdNumber(usdValue(project.coin.market?.fdv, project.coin.market?.usdReference))}<small> mc</small></b></Link>) : <span className="strip-empty">{loading ? 'reading finalized launches…' : error ? 'repository index temporarily unavailable' : 'no finalized launches yet — make the first commit.'}</span>}
    </div>
    <span className="strip-network"><i/>solana / mainnet</span>
  </div></div>
}
