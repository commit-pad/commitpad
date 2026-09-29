import { expect, test } from '@playwright/test'
import { COMMIT_CREATOR_FEE_BPS, COMMIT_FEE_RECIPIENT, COMMIT_POLICY, MICROSOFT_ASSET } from '../../lib/pump/policy'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/commit/launch-policy', route => route.fulfill({ json: { quote: MICROSOFT_ASSET, creatorFeeBps: COMMIT_CREATOR_FEE_BPS, feeRecipient: COMMIT_FEE_RECIPIENT, version: COMMIT_POLICY, checkedAt: Date.now() } }))
})

test('homepage, explore, OAuth configuration, and mobile layouts remain usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Fund the code.', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open-source software can fund itself.' })).toBeVisible()
  await page.screenshot({ path: 'test-results/commit-home-desktop.png', fullPage: true })
  await page.getByRole('link', { name: 'Explore Projects', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Search repository, ticker or mint' })).toBeVisible()
  for (const sort of ['Most Stars', 'Most Contributors', 'Volume', 'Creator Revenue']) { await page.getByRole('button', { name: sort, exact: true }).click(); await expect(page.getByRole('button', { name: sort, exact: true })).toHaveAttribute('aria-pressed', 'true') }
  await page.getByRole('textbox', { name: 'Search repository, ticker or mint' }).fill('no-such-repository')
  await expect(page.getByRole('heading', { name: 'No repositories match your search.' })).toBeVisible()
  await page.goto('/create')
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible()
  await expect(page.getByText('GitHub OAuth credentials must be configured', { exact: false })).toBeVisible()
  await page.screenshot({ path: 'test-results/commit-create-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/', '/explore', '/create', '/dashboard', '/account']) {
    await page.goto(path)
    await expect(page.locator('h1').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow on ${path}`).toBe(true)
  }
  await page.goto('/')
  await page.screenshot({ path: 'test-results/commit-home-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL('/dashboard')
  expect(errors).toEqual([])
})

test('unauthenticated launch metadata and private Vite storage are inaccessible', async ({ request }) => {
  const metadata = await request.post('/api/solana/metadata', { headers: { Origin: `http://127.0.0.1:${process.env.COMMIT_TEST_PORT || '5417'}` }, data: {} })
  expect(metadata.status()).toBe(401)
  expect((await request.get('/api/commit/repositories')).status()).toBe(401)
  const storage = await request.get('/@fs/tmp/opencode/commit-browser/commit.sqlite')
  expect(storage.status()).not.toBe(200)
})

test('project discovery switches layouts, filters categories, and supports keyboard search', async ({ page }) => {
  const fixture = (id: number, name: string, category: string, stars: number) => ({
    repo: { id, owner: 'ui-fixture', name, description: 'A repository fixture for testing project discovery.', stars, forks: 6, language: 'TypeScript', avatar: '/commit.svg', url: `https://github.com/ui-fixture/${name}`, updatedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), topics: [] },
    coin: { mint: `fixture-mint-${id}`, name, symbol: name.slice(0, 3).toUpperCase(), image: '/commit.svg', createdAt: Date.now(), market: { fdv: 100, progress: 12, complete: false, updatedAt: Date.now(), usdReference: { price: 120, updatedAt: Date.now(), source: 'Test fixture' } } },
    category, discovery: { contributors: 12, volume24h: 2500, revenue: 1.2, measuredAt: Date.now() },
  })
  await page.route('**/api/commit/projects', route => route.fulfill({ json: { items: [fixture(123, 'vector-engine', 'AI', 200), fixture(124, 'relay-kit', 'Developer Tools', 700), fixture(125, 'base-layer', 'Infrastructure', 400)] } }))
  await page.goto('/explore')
  await expect(page.locator('.project-table tbody tr')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/commit-explore-table.png', fullPage: true })
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await expect(page.locator('.project-card')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/commit-explore-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Table view', exact: true }).click()
  await expect(page.locator('.project-table tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: 'Most Stars', exact: true }).click()
  await expect(page.locator('.project-table tbody tr').first()).toContainText('relay-kit')
  await page.getByRole('group', { name: 'Project categories' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(page.locator('.project-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.project-table tbody tr')).toContainText('vector-engine')
  await page.getByRole('group', { name: 'Project categories' }).getByRole('button', { name: 'All projects' }).click()
  await page.keyboard.press('/')
  await expect(page.getByRole('textbox', { name: 'Search repository, ticker or mint' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Search repository, ticker or mint' }).fill('fixture-mint-125')
  await expect(page.locator('.project-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.project-table tbody tr')).toContainText('base-layer')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.project-card')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/commit-explore-mobile.png', fullPage: true })
  await page.goto('/create')
  await page.setViewportSize({ width: 768, height: 1024 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.keyboard.press('Control+k')
  await expect(page).toHaveURL('/explore')
  await expect(page.getByRole('textbox', { name: 'Search repository, ticker or mint' })).toBeFocused()
})

test('operator approves a request and records a manual payout without requesting a wallet transaction', async ({ page }) => {
  const collector = 'GDKuQbSr9v6AzC5ZWzXvnkQFkWULB7eWmovgS451J6Ya'
  const quote = { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', symbol: 'MSFTx', name: 'Microsoft xStock', decimals: 8, native: false, tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }
  const row = { id: 'fixture-request', repositoryId: 123, repository: 'builder/software', symbol: 'CODE', tokenMint: 'fixture-token', quote, userId: 2, login: 'builder', wallet: '11111111111111111111111111111111', quoteMint: quote.mint, amount: '25000000', status: 'pending', note: 'Approved parser work.', decisionNote: '', createdAt: Date.now(), updatedAt: Date.now(), signature: null as string | null, paidAt: null as number | null, decidedBy: null as number | null }
  let submissions = 0
  await page.route('**/api/commit/session', route => route.fulfill({ json: { user: { id: 1, login: 'operator', avatar: '/commit.svg' }, githubConfigured: true, payoutAdmin: true } }))
  await page.route('**/api/commit/payouts/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/admin')) return route.fulfill({ json: { items: row.status === url.searchParams.get('status') ? [row] : [], page: 1, next: null, collector } })
    if (url.pathname.endsWith('/decide')) { const body = route.request().postDataJSON(); expect(body).toMatchObject({ id: row.id, action: 'approve' }); row.status = 'approved'; return route.fulfill({ json: { request: row } }) }
    if (url.pathname.endsWith('/settle')) { expect(route.request().postDataJSON()).toEqual({ id: row.id, signature: 'fixture-manual-transfer' }); row.status = 'paid'; row.signature = 'fixture-manual-transfer'; return route.fulfill({ json: { request: row } }) }
    throw Error(`Unexpected operator endpoint ${url.pathname}`)
  })
  await page.route('**/api/solana/submit', route => { submissions++; return route.abort() })
  await page.goto('/admin/payouts')
  await expect(page.getByText('0.25 MSFTx', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve for manual payout' }).click()
  await expect(page.getByText('Request approved and locked', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'approved', exact: true }).click()
  await expect(page.getByText('Approval does not send funds.', { exact: false })).toBeVisible()
  await page.getByLabel('Manual transfer transaction signature').fill('fixture-manual-transfer')
  await page.getByRole('button', { name: 'Verify transfer & mark paid' }).click()
  await expect(page.getByText('Finalized transfer verified.', { exact: false })).toBeVisible()
  expect(submissions).toBe(0)
  await page.getByRole('button', { name: 'paid', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Verified payout transaction' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('terms, privacy and risk pages render, and anyone can report a coin', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  let report: Record<string, unknown> | null = null
  await page.route('**/api/commit/reports', async route => { report = route.request().postDataJSON(); await route.fulfill({ status: 201, json: { id: '0123456789abcdef' } }) })
  for (const [path, heading] of [['/terms', 'Terms of use.'], ['/privacy', 'Privacy.'], ['/risk', 'Know the risks.']] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
  await expect(page.locator('.footer-legal')).toContainText('report a coin')
  await page.goto('/report?coin=builder%2Fsoftware')
  await expect(page.getByLabel('Coin', { exact: true })).toHaveValue('builder/software')
  await page.getByLabel('Reason').selectOption('trademark')
  await page.getByLabel('What’s wrong').fill('This coin uses our project name and logo without permission.')
  await page.getByLabel('How to reach you').fill('@maintainer')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText('Report received (reference 01234567)', { exact: false })).toBeVisible()
  expect(report).toMatchObject({ target: 'builder/software', reason: 'trademark', relationship: 'maintainer', contact: '@maintainer' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
})

test('routing keeps query strings, ignores trailing slashes, and remembers the explore layout', async ({ page }) => {
  const item = { repo: { id: 7, owner: 'ui-fixture', name: 'relay-kit', description: 'Fixture.', stars: 3, forks: 1, language: 'TypeScript', avatar: '/commit.svg', url: 'https://github.com/ui-fixture/relay-kit', updatedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), topics: [] }, coin: { mint: 'fixture-mint-7', name: 'relay', symbol: 'RLY', image: '/commit.svg', createdAt: Date.now() }, treasury: COMMIT_FEE_RECIPIENT, category: 'AI', allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 }, launchUser: 1, maintainerWallets: [], discovery: { contributors: 1, volume24h: null, revenue: null, measuredAt: null } }
  await page.route('**/api/commit/projects', route => route.fulfill({ json: { items: [item] } }))
  await page.goto('/explore/')
  await expect(page.getByRole('heading', { name: 'repository markets.' })).toBeVisible()
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await page.locator('.project-card').first().click()
  await expect(page).toHaveURL('/ui-fixture/relay-kit')
  await page.goBack()
  await expect(page.locator('.project-card')).toHaveCount(1) // still grid after Back
  // In-app link with a query string opens the prefilled report form
  await page.evaluate(() => { history.pushState(null, '', '/report?coin=ui-fixture%2Frelay-kit'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByLabel('Coin', { exact: true })).toHaveValue('ui-fixture/relay-kit')
  // ⌘/Ctrl-K while typing keeps you (and your text) on the page
  await page.getByLabel('What’s wrong').fill('Draft text that must survive the shortcut.')
  await page.keyboard.press('Control+k')
  await expect(page).toHaveURL(/\/report/)
  await expect(page.getByLabel('What’s wrong')).toHaveValue('Draft text that must survive the shortcut.')
})

test('the header fits the smallest phones', async ({ page }) => {
  await page.route('**/api/commit/session', route => route.fulfill({ json: { user: null, githubConfigured: true } }))
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
