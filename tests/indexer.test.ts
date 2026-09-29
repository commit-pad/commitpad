import { afterEach, expect, it, vi } from 'vitest'
import { createMarketIndex } from '../lib/indexer/market'
afterEach(() => vi.unstubAllEnvs())
it('deduplicates indexed pair volume and excludes other chains and base mints', async () => {
  vi.stubEnv('SOLANA_INDEXER_URL', '')
  const pair = { chainId: 'solana', baseToken: { address: 'mint' }, pairAddress: 'pool', volume: { h24: 123 } }
  const index = createMarketIndex(async () => new Response(JSON.stringify([pair, pair, { ...pair, chainId: 'ethereum', pairAddress: 'wrong-chain' }, { ...pair, baseToken: { address: 'different-mint' }, pairAddress: 'wrong-base' }])))
  expect(await index('mint')).toMatchObject({ volume24h: 123, holders: null })
})
it('does not fabricate zero volume or holders after upstream failures', async () => {
  vi.stubEnv('SOLANA_INDEXER_URL', 'https://indexer.example')
  const index = createMarketIndex(async () => new Response('{}', { status: 503 }))
  expect(await index('mint')).toMatchObject({ volume24h: null, holders: null })
})
it('counts distinct nonzero owners across pages without counting token accounts as holders', async () => {
  vi.stubEnv('SOLANA_INDEXER_URL', 'https://indexer.example')
  let pages = 0
  const index = createMarketIndex(async input => {
    if (String(input).includes('dexscreener')) return new Response('[]')
    pages++
    return new Response(JSON.stringify({ result: { token_accounts: pages === 1 ? Array.from({ length: 1000 }, () => ({ owner: 'same-wallet', amount: 1 })) : [{ owner: 'second-wallet', amount: 1 }, { owner: 'empty-wallet', amount: 0 }], cursor: pages === 1 ? 'next-page' : undefined } }))
  })
  expect(await index('mint')).toMatchObject({ volume24h: null, holders: 2 })
  expect(pages).toBe(2)
})
it('leaves holder counts unavailable when a full page has no continuation cursor', async () => {
  vi.stubEnv('SOLANA_INDEXER_URL', 'https://indexer.example')
  const index = createMarketIndex(async input => new Response(String(input).includes('dexscreener') ? '[]' : JSON.stringify({ result: { token_accounts: Array.from({ length: 1000 }, (_, n) => ({ owner: `owner-${n}`, amount: 1 })) } })))
  expect((await index('mint')).holders).toBeNull()
})
