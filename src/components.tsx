import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowUpRight, Check, Code2, GitCommitHorizontal, GitFork, Github, Pin, Star, Users, X } from 'lucide-react'
import type { Project, Repository } from '../lib/types'
import { useApp } from './context'
import { usdNumber, usdValue } from '../packages/pump-core/client'
export function Link({ to, children, className = '', ariaLabel }: { to: string; children: ReactNode; className?: string; ariaLabel?: string }) { const { navigate } = useApp(); return <a className={className} href={to} aria-label={ariaLabel} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(to) } }}>{children}</a> }
export function Brand() { return <Link to="/" className="brand"><span className="brand-icon"><GitCommitHorizontal size={24} strokeWidth={2}/></span><span>commit</span><small>launchpad</small></Link> }
export const X_URL = 'https://x.com/commitpadfun'
export function XLogo({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg> }
export function External({ href, children }: { href: string; children: ReactNode }) { return <a href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13}/></a> }
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), previous = useRef<HTMLElement | null>(null)
  useEffect(() => { previous.current = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { previous.current?.focus() } }, [])
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); close() }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={18}/></button></div>{children}</dialog>
}
export const number = (n?: number | null) => n == null ? '—' : Intl.NumberFormat('en', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)
export function Verified({ at }: { at?: string }) { return <span className="verified" title={at ? `Repository permissions verified ${new Date(at).toLocaleString()}` : 'Server-verified repository permissions'}><Check size={12}/>Verified repository</span> }
/** Maintainer launches were made by someone with admin/maintain permission; community launches by anyone else. */
export function LaunchBadge({ project }: { project: Project }) {
  if (project.main) return <span className="verified main" title="Commit’s own coin, pinned site-wide. A standard SOL-paired Pump.fun coin."><Pin size={12}/>Main coin · pinned</span>
  return project.launch === 'community'
    ? <span className="verified community" title={`Launched by @${project.launchedBy || 'a Commit user'}, not by the repository’s maintainers. Its maintainers can claim the creator fees.`}><Users size={12}/>Community launch</span>
    : <span className="verified" title={`Launched with verified admin or maintainer permission, ${new Date(project.repo.verifiedAt).toLocaleString()}`}><Check size={12}/>Maintainer launch</span>
}
/** Community coins: has a GitHub-verified maintainer connected yet? */
export function ClaimBadge({ project }: { project: Project }) {
  if (project.launch !== 'community') return null
  return project.claimedAt ? <span className="verified" title={`Claimed by a maintainer (@${project.claimedBy}) on ${new Date(project.claimedAt).toLocaleDateString()}. Claiming is not an endorsement of the launch.`}><Check size={12}/>claimed by @{project.claimedBy}</span> : <span className="verified unclaimed" title="No maintainer has claimed it yet. Its maintainers can claim the creator fees.">unclaimed</span>
}
export function ForkLabel({ repo }: { repo: Repository }) {
  if (!repo.forked) return null
  return repo.parent ? <a className="fork-label" href={repo.parent.url} target="_blank" rel="noreferrer" title="This repository is a fork. Its maintainers are not the original project’s."><GitFork size={12}/>fork of {repo.parent.owner}/{repo.parent.name}</a> : <span className="fork-label"><GitFork size={12}/>fork</span>
}
export function RepoPreview({ repo, contributors, maintainer = true }: { repo: Repository; contributors?: number; maintainer?: boolean }) {
  return <div className="repo-preview"><div className="eyebrow">{maintainer ? 'CONNECTED REPOSITORY' : 'PUBLIC REPOSITORY / COMMUNITY LAUNCH'}</div><div className="repo-avatar"><img src={repo.avatar} alt=""/><Github size={18}/></div><span className="mono muted">{repo.owner} /</span><h3>{repo.name}</h3>{maintainer ? <Verified at={repo.verifiedAt}/> : <span className="verified community"><Users size={12}/>You don’t maintain this</span>}<ForkLabel repo={repo}/><p>{repo.description || 'An open-source project, built in public.'}</p><div className="repo-stats"><span><Star size={14}/>{number(repo.stars)}</span><span><GitFork size={14}/>{number(repo.forks)}</span><span className="language-dot"/>{repo.language || 'Open source'}</div>{contributors !== undefined && <p className="mono small">{number(contributors)} contributors</p>}<External href={repo.url}>View on GitHub</External></div>
}
/** Commit's main coin, pinned above every market list. */
export function MainPin({ project }: { project: Project }) {
  const { repo, coin } = project
  return <Link to={`/${repo.owner}/${repo.name}`} className="main-pin"><span className="main-pin-label"><Pin size={13}/>pinned · main coin</span><img src={coin.image || repo.avatar} alt=""/><strong>${coin.symbol}</strong><span className="main-pin-name">{coin.name}</span><span className="main-pin-repo">{repo.owner}/{repo.name}</span><span className="main-pin-mc">{usdNumber(usdValue(coin.market?.fdv, coin.market?.usdReference))}<small>mc</small></span><ArrowUpRight size={16}/></Link>
}
export function ProjectCard({ project }: { project: Project }) {
  const { repo, coin } = project, community = project.launch === 'community'
  return <Link to={`/${repo.owner}/${repo.name}`} className="project-card">
    <div className={`project-cover cover-${repo.id % 3}`}><span className="cover-category">{project.category}</span><Code2 size={18}/><img src={coin.image || repo.avatar} alt=""/><span className="cover-caption mono">{repo.owner} /</span><span className="cover-arrow"><ArrowUpRight size={18}/></span></div>
    <div className="project-card-body"><div className="card-title"><h3>{repo.name}{!community && <Check size={14}/>}</h3><span className="ticker">${coin.symbol}</span></div><p>{repo.description || coin.description}</p>
    <div className="repo-stats"><span><i className="language-dot"/>{repo.language || 'Open source'}</span><span><Star size={13}/>{number(repo.stars)}</span><span><Users size={13}/>{number(project.discovery?.contributors)}</span></div>
    <div className="card-data"><div><span>MARKET CAP</span><strong>{usdNumber(usdValue(coin.market?.fdv, coin.market?.usdReference))}</strong></div><div><span>24H VOLUME</span><strong>{usdNumber(project.discovery?.volume24h)}</strong></div><div><span>CREATOR REVENUE</span><strong>{number(project.discovery?.revenue)} {coin.quote?.symbol || '—'}</strong></div><div><span>PAIR / CURVE</span><strong>{coin.quote?.symbol || '—'} · {coin.market ? coin.market.complete ? 'Graduated' : `${number(coin.market.progress)}%` : 'Indexing'}</strong></div></div>
    <div className="card-foot">{project.main ? <span className="main"><Pin size={11} strokeWidth={2.5}/>main coin</span> : community ? <span className="community"><Users size={11} strokeWidth={2.5}/>community · {project.claimedAt ? 'claimed' : 'unclaimed'}</span> : <span><Check size={11} strokeWidth={2.5}/>maintainer launch</span>}{repo.forked && <span className="fork-label"><GitFork size={11}/>fork</span>}<span>{coin.market?.complete ? 'PumpSwap' : 'Pump.fun'} ↗</span></div></div>
  </Link>
}
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><GitCommitHorizontal size={34}/><h3>{title}</h3><p>{children}</p></div> }
export function Notice({ children }: { children: ReactNode }) { return <div className="notice" role="status">{children}</div> }
