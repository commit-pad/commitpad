import { HttpError } from '../../packages/pump-core/server'
import type { Development, Repository } from '../types'
type GitRepo = { id: number; name: string; owner: { login: string; avatar_url: string }; private: boolean; archived: boolean; disabled: boolean; description: string | null; stargazers_count: number; forks_count: number; language: string | null; html_url: string; pushed_at: string; topics?: string[]; permissions?: { admin?: boolean; maintain?: boolean }; fork?: boolean; parent?: { name: string; owner: { login: string }; html_url: string }; source?: { name: string; owner: { login: string }; html_url: string } }
export const isLaunchable = (repo: Pick<GitRepo, 'private' | 'archived' | 'disabled'>) => !repo.private && !repo.archived && !repo.disabled
export const canManage = (repo: Pick<GitRepo, 'private' | 'archived' | 'disabled' | 'permissions'>) => isLaunchable(repo) && !!(repo.permissions?.admin || repo.permissions?.maintain)
/** Claims and project settings survive archiving: fees earned before a repository was archived stay with its maintainers. */
export const canClaim = (repo: Pick<GitRepo, 'private' | 'permissions'>) => !repo.private && !!(repo.permissions?.admin || repo.permissions?.maintain)
/** Accepts `owner/name`, `github.com/owner/name` or a GitHub URL (extra path segments and `.git` are ignored). */
export function parseRepository(input: unknown) {
  const match = typeof input === 'string' && input.length <= 300 ? /^\s*(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z\d](?:[A-Za-z\d-]{0,38}))\/([\w.-]{1,100}?)(?:\.git)?(?:[/?#].*)?\s*$/.exec(input) : null
  if (!match || match[2] === '.' || match[2] === '..') throw new HttpError(400, 'Enter a GitHub repository as owner/name or its github.com URL.')
  return { owner: match[1], name: match[2] }
}
// Single-repository responses carry the fork's origin (`source` is the root of a fork chain); list responses only say `fork: true`.
const fork = (repo: GitRepo) => { const origin = repo.source || repo.parent; return repo.fork && origin ? { owner: origin.owner.login, name: origin.name, url: origin.html_url } : null }
export class GitHub {
  constructor(private request: typeof fetch = fetch) {}
  async get<T>(path: string, token?: string): Promise<{ data: T; link: string }> {
    const response = await this.request(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Commit-Launchpad', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) throw new HttpError(response.status === 401 ? 401 : response.status === 403 || response.status === 404 ? 403 : 503, response.status === 401 ? 'GitHub authorization expired. Sign in again.' : 'GitHub could not verify this resource. Check repository access, organization approval, or retry after the GitHub rate limit resets.')
    return { data: (response.status === 204 ? [] : await response.json()) as T, link: response.headers.get('link') || '' }
  }
  normalize(repo: GitRepo): Repository { return { id: repo.id, owner: repo.owner.login, name: repo.name, description: repo.description || '', stars: repo.stargazers_count, forks: repo.forks_count, language: repo.language, url: repo.html_url, avatar: repo.owner.avatar_url, updatedAt: repo.pushed_at, topics: repo.topics || [], verifiedAt: new Date().toISOString(), forked: !!repo.fork, parent: fork(repo) } }
  async repositories(token: string, page: number, { forClaims = false } = {}) {
    const { data, link } = await this.get<GitRepo[]>(`/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, token)
    return { items: data.filter(forClaims ? canClaim : canManage).map(repo => this.normalize(repo)), next: link.includes('rel="next"') ? page + 1 : null }
  }
  async verify(id: number, token: string, { forClaims = false } = {}) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Choose a repository.')
    const { data } = await this.get<GitRepo>(`/repositories/${id}`, token)
    if (data.id !== id || !(forClaims ? canClaim(data) : canManage(data))) throw new HttpError(403, 'Admin or maintainer permission on an active public repository is required.')
    return this.normalize(data)
  }
  /** Any active public repository can be launched. `maintainer` records whether the signed-in user manages it;
   *  fee claims and project settings are always re-checked with `verify`, never with this flag. */
  async launchable(ref: number | string, token: string): Promise<{ repo: Repository; maintainer: boolean }> {
    let data: GitRepo
    if (typeof ref === 'number') {
      if (!Number.isSafeInteger(ref) || ref <= 0) throw new HttpError(400, 'Choose a repository.')
      data = (await this.get<GitRepo>(`/repositories/${ref}`, token)).data
      if (data.id !== ref) throw new HttpError(403, 'GitHub returned a different repository. Choose it again.')
    } else {
      const { owner, name } = parseRepository(ref)
      try { data = (await this.get<GitRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token)).data }
      catch (e) {
        if (e instanceof HttpError && e.status !== 403) throw e
        throw new HttpError(404, `No public GitHub repository found at ${owner}/${name}. Check the name (renamed repositories need their current owner/name), or retry if GitHub is rate-limiting.`)
      }
    }
    if (!isLaunchable(data)) throw new HttpError(403, 'Only active public GitHub repositories can be launched.')
    return { repo: this.normalize(data), maintainer: canManage(data) }
  }
  async development(repo: Repository, token?: string): Promise<Development> {
    const current = (await this.get<GitRepo>(`/repositories/${repo.id}`, token)).data
    if (current.id !== repo.id || current.private) throw new HttpError(403, 'Repository is no longer publicly accessible.')
    const repository = { ...this.normalize(current), verifiedAt: repo.verifiedAt }
    const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
    const [contributors, count, releases, pulls, events] = await Promise.all([
      this.get<Development['contributors']>(`${base}/contributors?per_page=100`, token),
      this.get<Development['contributors']>(`${base}/contributors?per_page=1`, token),
      this.get<Development['releases']>(`${base}/releases?per_page=6`, token),
      this.get<Development['pulls']>(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, token),
      this.get<Development['events']>(`${base}/events?per_page=100`, token),
    ])
    const last = count.link.match(/[?&]page=(\d+)>; rel="last"/)
    // Keep only the fields the site shows: raw GitHub payloads are ~0.5 MB for busy repositories.
    return {
      repository, contributorCount: last ? Number(last[1]) : count.data.length, fetchedAt: new Date().toISOString(),
      contributors: contributors.data.map(c => ({ id: c.id, login: c.login, avatar_url: c.avatar_url, html_url: c.html_url })),
      releases: releases.data.map(r => ({ name: r.name, tag_name: r.tag_name, html_url: r.html_url, published_at: r.published_at })),
      pulls: pulls.data.filter(p => p.merged_at).slice(0, 15).map(p => ({ number: p.number, title: p.title, html_url: p.html_url, merged_at: p.merged_at, user: { login: p.user?.login } })),
      events: events.data.map(e => ({ id: e.id, type: e.type, created_at: e.created_at, actor: { login: e.actor?.login }, payload: { size: e.payload?.size } })),
    }
  }
}
