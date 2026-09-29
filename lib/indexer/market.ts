import type { MetricPoint } from '../types'
export type ExtraMarket = { volume24h: number | null; holders: number | null; source: string; updatedAt: string; notice?: string; history?: MetricPoint[] }
export function createMarketIndex(request: typeof fetch = fetch) {
  const cache = new Map<string, { until: number; promise: Promise<ExtraMarket> }>()
  return (mint: string) => {
    const existing = cache.get(mint); if (existing && existing.until > Date.now()) return existing.promise
    const promise = (async () => {
      const result: ExtraMarket = { volume24h: null, holders: null, source: 'DexScreener / configured Solana indexer', updatedAt: new Date().toISOString() }
      try {
        const response = await request(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })
        if (!response.ok) throw Error()
        const pairs = await response.json() as { chainId: string; baseToken: { address: string }; pairAddress: string; volume?: { h24?: number } }[]
        const unique = new Map(pairs.filter(p => p.chainId === 'solana' && p.baseToken.address === mint).map(p => [p.pairAddress, p]))
        const volumes = [...unique.values()].map(p => p.volume?.h24).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
        if (volumes.length) result.volume24h = volumes.reduce((sum, n) => sum + n, 0)
      } catch { result.notice = 'External volume index is unavailable.' }
      if (process.env.SOLANA_INDEXER_URL) {
        try {
          const owners = new Set<string>(); let cursor: string | undefined
          for (let page = 0; page < 20; page++) {
            const response = await request(process.env.SOLANA_INDEXER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccounts', params: { mint, limit: 1000, ...(cursor ? { cursor } : {}), options: { showZeroBalance: false } } }), signal: AbortSignal.timeout(8000) })
            const value = await response.json() as { error?: unknown; result?: { token_accounts: { owner: string; amount: number }[]; cursor?: string } }
            if (!response.ok || value.error || !Array.isArray(value.result?.token_accounts)) throw Error()
            value.result.token_accounts.forEach(account => { if (account.amount > 0) owners.add(account.owner) })
            if (value.result.token_accounts.length < 1000) { result.holders = owners.size; break }
            if (!value.result.cursor) throw Error()
            if (value.result.cursor === cursor) throw Error()
            cursor = value.result.cursor
          }
        } catch { result.notice = [result.notice, 'Holder index is unavailable.'].filter(Boolean).join(' ') }
      }
      return result
    })()
    if (cache.size > 500) for (const [key, value] of cache) if (value.until < Date.now()) cache.delete(key)
    const entry = { until: Infinity, promise }
    cache.set(mint, entry)
    void promise.finally(() => { entry.until = Date.now() + 60000 }).catch(() => {})
    return promise
  }
}
