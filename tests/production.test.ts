import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'

it.each([false, true])('boots with security headers and closed auth gates when public preview=%s', async preview => {
  const directory = await mkdtemp('/tmp/opencode/commit-production-')
  const probe = createServer()
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(done => probe.close(() => done()))
  const child = spawn(process.execPath, ['--no-addons', '--import', 'tsx', 'server/start.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', COMMIT_DATA_DIR: directory, COMMIT_PUBLIC_ORIGIN: 'https://commit.example', GITHUB_CLIENT_ID: preview ? '' : 'production-test-client', GITHUB_CLIENT_SECRET: preview ? '' : 'production-test-secret', COMMIT_SESSION_KEY: 'cd'.repeat(32), COMMIT_PUBLIC_PREVIEW: preview ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stderr.on('data', data => { logs += data.toString() })
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error(`Startup timeout: ${logs}`)), 10000); child.stdout.on('data', data => { logs += data.toString(); if (logs.includes('server listening')) { clearTimeout(timer); resolve() } }); child.once('exit', code => { clearTimeout(timer); reject(Error(`Server exited ${code}: ${logs}`)) }) })
    const base = `http://127.0.0.1:${port}`
    const page = await fetch(base)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Fund the code.')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('strict-transport-security')).toContain('max-age')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await (await fetch(`${base}/api/commit/projects`)).json()).items).toEqual([])
    expect((await (await fetch(`${base}/api/commit/session`)).json()).githubConfigured).toBe(!preview)
    if (preview) {
      expect((await fetch(`${base}/api/auth/login`)).status).toBe(503)
      expect((await fetch(`${base}/api/commit/repositories`)).status).toBe(401)
      expect((await fetch(`${base}/api/solana/metadata`, { method: 'POST', headers: { Origin: 'https://commit.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    }
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404)
    expect((await fetch(`${base}/.env.local`)).status).toBe(404)
    const denied = await fetch(`${base}/api/solana/metadata`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })
    expect(denied.status).toBe(403)
  } finally {
    child.kill('SIGTERM')
    await new Promise<void>(done => { if (child.exitCode !== null) done(); else child.once('exit', () => done()) })
    await rm(directory, { recursive: true, force: true })
  }
})
