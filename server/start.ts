import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { createApp } from './app'
import { securityHeaders } from '../packages/pump-core/server'
import { pageMeta, withMeta } from '../lib/seo'
try { process.loadEnvFile('.env.local') } catch { /* Deployment may supply environment variables. */ }
process.env.NODE_ENV = 'production'
if (!process.env.COMMIT_PUBLIC_ORIGIN || !process.env.COMMIT_SESSION_KEY) throw Error('Configure COMMIT_PUBLIC_ORIGIN and COMMIT_SESSION_KEY before production startup.')
const githubConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
if (!githubConfigured && process.env.COMMIT_PUBLIC_PREVIEW !== '1') throw Error('Configure GitHub OAuth credentials, or explicitly enable COMMIT_PUBLIC_PREVIEW=1 for a public site with authentication unavailable.')
if (!githubConfigured) console.info('Commit public preview: GitHub sign-in and repository launches require OAuth configuration.')
const app = createApp(), root = resolve('dist'), origin = process.env.COMMIT_PUBLIC_ORIGIN
const reserved = new Set(['dashboard', 'admin', 'api', 'uploads', 'metadata', 'assets', 'badge'])
/** Per-page title / description / social card, so shared links preview correctly without running the app. */
function htmlFor(content: Buffer, pathname: string) {
  const slug = /^\/([\w.-]+)\/([\w.-]+)\/?$/.exec(pathname), project = slug && !reserved.has(slug[1]) ? app.store.bySlug(slug[1], slug[2]) : undefined
  return Buffer.from(withMeta(content.toString('utf8'), pageMeta(origin!, pathname.replace(/\/$/, '') || '/', project)))
}
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2' }
const interval = setInterval(() => void app.refresh().catch(() => console.error('Commit background refresh failed; retry scheduled.')), 30000)
const server = createServer({ requestTimeout: 20000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (req, res) => {
  securityHeaders(res)
  try {
    if (await app.handler(req, res)) return
    if (req.url?.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Not found."}'); return }
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405); res.end(); return }
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
    const upload = app.pump.images.pathFor(pathname)
    if (pathname.startsWith('/uploads/') && !upload) { res.writeHead(404); res.end(); return }
    let file = upload || resolve(root, `.${pathname}`)
    if (!upload && file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
    // Missing build assets are real 404s; any other path is an app route (repository names like vercel/next.js
    // or socket.io contain dots, so an "extension" alone doesn't mean a file was requested).
    try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html') } catch { if (extname(file) && (pathname.startsWith('/assets/') || /^\/[^/]+\.[a-z0-9]{2,5}$/i.test(pathname))) { res.writeHead(404); res.end(); return } file = resolve(root, 'index.html') }
    const content = file === resolve(root, 'index.html') ? htmlFor(await readFile(file), pathname) : await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': upload || file.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content)
  } catch { if (!res.headersSent) res.writeHead(500); res.end('Request failed.') }
})
server.listen(Number(process.env.PORT || 5190), process.env.HOST || '127.0.0.1', () => console.log('Commit server listening.'))
function shutdown() { clearInterval(interval); server.close(() => { app.store.db.close(); process.exit(0) }); setTimeout(() => process.exit(1), 15000).unref() }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
