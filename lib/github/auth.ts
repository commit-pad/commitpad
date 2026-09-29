import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from '../../packages/pump-core/server'
import type { Store } from '../repositories/store'
import { GitHub } from './api'
import type { User } from '../types'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
/** Where to land after sign-in: a same-site path only (no scheme, host, `//` or `..`). */
export const safeNext = (value: string | null | undefined) => value && /^\/(?!\/)[\w\-./]{0,200}$/.test(value) && !value.includes('..') ? value : null
function cookie(req: IncomingMessage, name: string) { return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1) || '' }
export function createAuth(store: Store, github: GitHub, config: { origin: string; clientId?: string; clientSecret?: string; encryptionKey?: string }, request: typeof fetch = fetch) {
  const secure = config.origin.startsWith('https:')
  const sessionCookie = secure ? '__Host-commit_session' : 'commit_session'
  const oauthCookie = secure ? '__Host-commit_oauth' : 'commit_oauth'
  const nextCookie = secure ? '__Host-commit_next' : 'commit_next'
  const key = config.encryptionKey ? Buffer.from(config.encryptionKey, 'hex') : null
  if (config.encryptionKey && !/^[0-9a-f]{64}$/i.test(config.encryptionKey)) throw Error('COMMIT_SESSION_KEY must contain 64 hexadecimal characters.')
  const available = !!(key && config.clientId && config.clientSecret)
  const cookieValue = (name: string, value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`
  const setCookie = (res: ServerResponse, name: string, value: string, age: number) => res.setHeader('Set-Cookie', cookieValue(name, value, age))
  function encrypt(value: string) { if (!key) throw new HttpError(503, 'GitHub sign-in has not been configured.'); const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64') }
  function decrypt(value: string) { if (!key) throw new HttpError(503, 'GitHub sign-in has not been configured.'); const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8') }
  function session(req: IncomingMessage) {
    const id = cookie(req, sessionCookie); if (!id) return undefined
    const row = store.session(hash(id)); if (!row) return undefined
    try { return { user: { ...row.user, wallet: store.wallet(row.user.id) }, token: decrypt(row.token) } }
    catch { store.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(id)); return undefined }
  }
  function requireSession(req: IncomingMessage) { const value = session(req); if (!value) throw new HttpError(401, 'Sign in with GitHub to continue.'); return value }
  return {
    available, session, requireSession,
    start(res: ServerResponse, next?: string | null) {
      if (!available) throw new HttpError(503, 'GitHub sign-in requires server configuration. See the deployment guide.')
      store.cleanup()
      const state = random(), verifier = random()
      store.db.prepare('INSERT INTO oauth(id,verifier,expires) VALUES(?,?,?)').run(hash(state), verifier, Date.now() + 600000)
      const back = safeNext(next)
      res.setHeader('Set-Cookie', [cookieValue(oauthCookie, state, 600), back ? cookieValue(nextCookie, encodeURIComponent(back), 600) : cookieValue(nextCookie, '', 0)]) // no stale return page from an earlier attempt
      const url = new URL('https://github.com/login/oauth/authorize')
      Object.entries({ client_id: config.clientId!, redirect_uri: `${config.origin}/api/auth/callback`, scope: 'read:user public_repo read:org', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).forEach(([k, v]) => url.searchParams.set(k, v))
      res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' }); res.end()
    },
    async callback(req: IncomingMessage, res: ServerResponse, url: URL) {
      const state = url.searchParams.get('state') || '', browser = cookie(req, oauthCookie)
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || state.length !== browser.length || Buffer.byteLength(state) !== Buffer.byteLength(browser) || !timingSafeEqual(Buffer.from(state), Buffer.from(browser))) throw new HttpError(403, 'GitHub OAuth state mismatch. Start sign-in again.')
      const pending = store.db.prepare('DELETE FROM oauth WHERE id=? AND expires>? RETURNING verifier').get(hash(state), Date.now()) as { verifier: string } | undefined
      if (!pending || !url.searchParams.get('code')) throw new HttpError(403, 'GitHub sign-in expired or was declined. Start again.')
      const response = await request('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code: url.searchParams.get('code'), redirect_uri: `${config.origin}/api/auth/callback`, code_verifier: pending.verifier }), signal: AbortSignal.timeout(15000), redirect: 'error' })
      const token = await response.json() as { access_token?: string }
      if (!response.ok || !token.access_token) throw new HttpError(403, 'GitHub authorization failed. Start sign-in again.')
      const { data } = await github.get<{ id: number; login: string; avatar_url: string }>('/user', token.access_token)
      const user: User = { id: data.id, login: data.login, avatar: data.avatar_url }, id = random()
      store.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(cookie(req, sessionCookie)))
      store.db.prepare('INSERT INTO sessions(id,user,token,expires) VALUES(?,?,?,?)').run(hash(id), JSON.stringify(user), encrypt(token.access_token), Date.now() + 8 * 3600000)
      let back: string | null = null
      try { back = safeNext(decodeURIComponent(cookie(req, nextCookie))) } catch { /* malformed cookie: use the default */ }
      res.setHeader('Set-Cookie', [cookieValue(sessionCookie, id, 8 * 3600), ...(back ? [cookieValue(nextCookie, '', 0)] : [])])
      res.writeHead(302, { Location: back || '/create', 'Cache-Control': 'no-store' }); res.end()
    },
    logout(req: IncomingMessage, res: ServerResponse) { store.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(cookie(req, sessionCookie))); setCookie(res, sessionCookie, '', 0) },
  }
}
export type Auth = ReturnType<typeof createAuth>
