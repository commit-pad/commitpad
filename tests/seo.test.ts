import { describe, expect, it, vi } from 'vitest'
import { badge, pageMeta, withMeta } from '../lib/seo'
import { createAlerts, quote } from '../lib/alerts'
import type { Project } from '../lib/types'

const origin = 'https://commitpad.fun'
const project = (extra: Partial<Project> = {}) => ({ repo: { owner: 'builder', name: 'software' }, coin: { symbol: 'CODE', image: `${origin}/uploads/a.png` }, launch: 'maintainer', ...extra }) as unknown as Project
const html = '<html><head><meta charset="UTF-8"/><meta name="description" content="old"/><meta name="twitter:site" content="@commitpadfun"/><meta property="og:image" content="old.png"/><meta name="twitter:card" content="summary_large_image"/><title>Old</title></head><body></body></html>'

describe('link previews', () => {
  it('uses the site card by default and a per-coin card on coin pages', () => {
    expect(pageMeta(origin, '/')).toMatchObject({ title: 'Commit — Fund the code.', image: `${origin}/og.png`, card: 'summary_large_image' })
    expect(pageMeta(origin, '/payouts').title).toBe('Request your payout · Commit')
    const coin = pageMeta(origin, '/builder/software', project())
    expect(coin).toMatchObject({ title: '$CODE · builder/software · Commit', image: `${origin}/uploads/a.png`, card: 'summary', url: `${origin}/builder/software` })
    expect(pageMeta(origin, '/builder/software', project({ launch: 'community', launchedBy: 'someone' })).description).toContain('not endorsed by its maintainers')
    expect(pageMeta(origin, '/builder/software', project({ hidden: { at: '', reason: 'x' } })).title).toBe('Commit — Fund the code.')
    expect(pageMeta(origin, '/x/y', project({ coin: { symbol: 'A', image: 'https://elsewhere.example/a.png' } as Project['coin'] })).image).toBe(`${origin}/og.png`)
  })
  it('replaces title, description and social tags, keeps twitter:site, and escapes values', () => {
    const out = withMeta(html, { title: 'A "quoted" <title>', description: 'd & e', image: `${origin}/og.png`, card: 'summary', url: `${origin}/` })
    expect(out).not.toContain('content="old"'); expect(out).not.toContain('old.png'); expect(out).not.toContain('<title>Old</title>')
    expect(out).toContain('<meta name="twitter:site" content="@commitpadfun"/>')
    expect(out).toContain('<title>A &quot;quoted&quot; &lt;title&gt;</title>')
    expect(out).toContain('content="d &amp; e"')
    expect(out.match(/twitter:card/g)).toHaveLength(1)
  })
  it("keeps $' and $& literal instead of splicing the page into its own tags", () => {
    const out = withMeta(html, pageMeta(origin, "/x$'Your wallet is compromised"))
    expect(out.split('</head>')[0]).not.toContain('<body>')
    expect(out).toContain(`content="${origin}/x$'Your wallet is compromised"`)
    expect(out.match(/<\/head>/g)).toHaveLength(1)
  })
  it('draws a README badge with the ticker, or an invitation when there is no coin', () => {
    expect(badge(project())).toContain('$CODE')
    expect(badge()).toContain('launch on commit')
    expect(badge(project({ coin: { symbol: '<x>' } as Project['coin'] }))).not.toContain('<x>')
  })
})

describe('operator alerts', () => {
  it('posts to an https webhook and is off without one', async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    const alerts = createAlerts('https://discord.example/api/webhooks/1/x', request as unknown as typeof fetch)
    alerts.send('New payout request')
    expect(request).toHaveBeenCalledOnce()
    expect(JSON.parse((request.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string)).toEqual({ content: 'New payout request', text: 'New payout request', allowed_mentions: { parse: [] } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(createAlerts('http://insecure.example', request as unknown as typeof fetch).enabled).toBe(false)
    expect(createAlerts(undefined, request as unknown as typeof fetch).enabled).toBe(false)
    error.mockRestore()
  })
})

describe('price display', () => {
  it('shows very small prices compactly with the zero count as a subscript', async () => {
    const { tinyPrice } = await import('../src/Project')
    expect(tinyPrice(0.0000040244, '$', '')).toBe('$0.0₅4024')
    expect(tinyPrice(0.00012345, '', ' MSFTx')).toBe('0.0₃1234 MSFTx')
    expect(tinyPrice(1.05e-8, '$', '')).toBe('$0.0₇105')
    for (const v of [0.001, 0.5, 0, -1, null, undefined, NaN]) expect(tinyPrice(v as number, '$', '')).toBeNull()
  })
})

describe('alert text', () => {
  it('makes user-supplied text inert', () => {
    expect(quote('@everyone see `x`\nhttps://evil.example')).toBe('`@\u200beveryone see  x  https://evil.example`')
    expect(quote('a'.repeat(300)).length).toBe(122)
  })
})
