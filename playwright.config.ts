import { defineConfig } from '@playwright/test'
const port = process.env.COMMIT_TEST_PORT || '5417'
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60000, env: { COMMIT_DATA_DIR: '/tmp/opencode/commit-browser', COMMIT_PUBLIC_ORIGIN: `https://localhost:${port}`, GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', COMMIT_SESSION_KEY: '' } },
})
