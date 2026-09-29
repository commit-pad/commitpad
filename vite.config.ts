import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createApp } from './server/app'
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), { name: 'commit-api', configureServer(server) {
      const app = createApp()
      server.middlewares.use((req, res, next) => { void (async () => {
        if (await app.handler(req, res)) return
        const path = new URL(req.url || '/', 'http://localhost').pathname
        if (path.startsWith('/uploads/')) {
          const file = app.pump.images.pathFor(path)
          if (!file || !['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(404); res.end(); return }
          try { const content = await readFile(file); res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : 'image/gif'); res.end(req.method === 'HEAD' ? undefined : content) } catch { res.writeHead(404); res.end() }
          return
        }
        next()
      })().catch(next) })
      let running = false
      const timer = setInterval(() => { if (!running) { running = true; void app.refresh().catch(() => {}).finally(() => { running = false }) } }, 30000)
      server.httpServer?.once('close', () => { clearInterval(timer); if (!running) app.store.db.close() })
    } }],
    resolve: { dedupe: ['react', 'react-dom', '@solana/web3.js', '@wallet-standard/app', '@wallet-standard/base', 'buffer'] },
    server: { port: 5190, fs: { allow: [resolve('.'), resolve('../pawn-solana')], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.commit-data/**', '**/.pawn-solana/**', '**/*.sqlite*'] } },
    build: { chunkSizeWarningLimit: 800 },
  }
})
