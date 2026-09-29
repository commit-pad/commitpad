import type { Project } from './types'

// Link previews: crawlers (X, Discord, Slack) don't run the SPA, so the server rewrites index.html's head per page.
export type PageMeta = { title: string; description: string; image: string; card: 'summary' | 'summary_large_image'; url: string }
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const SITE_DESCRIPTION = 'Fund the code. Launch a coin for any public GitHub repository through Pump.fun. Its maintainers claim the creator fees.'
const pages: Record<string, [string, string]> = {
  '/explore': ['Repository markets · Commit', 'Coins for open-source repositories, with the code, contributors and market side by side.'],
  '/create': ['Launch a repository · Commit', 'Launch a coin for any public GitHub repository. Its maintainers claim the creator fees.'],
  '/payouts': ['Request your payout · Commit', 'Connect GitHub to see every coin tied to repositories you maintain, and request your creator-fee payouts.'],
  '/unclaimed': ['Unclaimed fees · Commit', 'Community-launched coins whose maintainers have not connected yet. Maintain one? Connect GitHub to claim.'],
  '/terms': ['Terms · Commit', 'Terms of use for Commit.'],
  '/privacy': ['Privacy · Commit', 'What Commit stores and why.'],
  '/risk': ['Risks · Commit', 'Risk disclosure for coins launched on Commit.'],
  '/report': ['Report a coin · Commit', 'Report a coin that impersonates a project or misleads buyers.'],
}
export function pageMeta(origin: string, pathname: string, project?: Project): PageMeta {
  const url = `${origin}${pathname}`, fallback: PageMeta = { title: 'Commit — Fund the code.', description: SITE_DESCRIPTION, image: `${origin}/og.png`, card: 'summary_large_image', url }
  if (project && !project.hidden) {
    const slug = `${project.repo.owner}/${project.repo.name}`, symbol = project.coin.symbol
    const description = project.main ? `$${symbol}, Commit’s main coin. Fund the code.` : project.launch === 'community'
      ? `Community launch of ${slug} by @${project.launchedBy || 'a Commit user'}, not endorsed by its maintainers. ${project.claimedAt ? 'Claimed by a maintainer.' : 'Its maintainers can claim the creator fees.'}`
      : `${slug}, launched by its maintainers on Commit. The creator fees go to the people building it.`
    const image = project.coin.image?.startsWith(`${origin}/`) ? project.coin.image : `${origin}/og.png`
    return { title: `$${symbol} · ${slug} · Commit`, description, image, card: image.endsWith('/og.png') ? 'summary_large_image' : 'summary', url }
  }
  const page = pages[pathname]
  return page ? { ...fallback, title: page[0], description: page[1] } : fallback
}
/** Replace the title, description and social tags in index.html (twitter:site is kept). */
export function withMeta(html: string, meta: PageMeta) {
  const tags = [
    `<title>${escape(meta.title)}</title>`, `<meta name="description" content="${escape(meta.description)}"/>`,
    `<meta property="og:type" content="website"/>`, `<meta property="og:site_name" content="Commit"/>`, `<meta property="og:url" content="${escape(meta.url)}"/>`,
    `<meta property="og:title" content="${escape(meta.title)}"/>`, `<meta property="og:description" content="${escape(meta.description)}"/>`, `<meta property="og:image" content="${escape(meta.image)}"/>`,
    `<meta name="twitter:card" content="${meta.card}"/>`, `<meta name="twitter:title" content="${escape(meta.title)}"/>`, `<meta name="twitter:description" content="${escape(meta.description)}"/>`, `<meta name="twitter:image" content="${escape(meta.image)}"/>`,
  ].join('')
  return html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta (?:name|property)="(?:description|og:[a-z_]+|twitter:(?!site)[a-z_]+)" content="[^"]*"\/?>/g, '')
    .replace('</head>', () => `${tags}</head>`) // a function: `$'`, `$&` in titles or URLs must stay literal
}

/** README badge: "commit | $TICKER" (or "launch on commit" when the repository has no coin). */
export function badge(project?: Project) {
  const left = 'commit.', right = project && !project.hidden ? `$${project.coin.symbol}` : 'launch on commit'
  const char = 6.6, pad = 8, lw = Math.round(left.length * char + pad * 2), rw = Math.round(right.length * char + pad * 2), w = lw + rw
  const label = project && !project.hidden ? `Backed on Commit: $${project.coin.symbol}` : 'Launch this repository on Commit'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>`
    + `<rect width="${lw}" height="20" fill="#000"/><rect x="${lw}" width="${rw}" height="20" fill="#ddff00"/>`
    + `<g font-family="DejaVu Sans Mono,Menlo,Consolas,monospace" font-size="11" text-anchor="middle">`
    + `<text x="${lw / 2}" y="14" fill="#f0f0f0">commit<tspan fill="#ddff00">.</tspan></text><text x="${lw + rw / 2}" y="14" fill="#000">${escape(right)}</text></g></svg>`
}
