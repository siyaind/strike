import { InfoClient, MetaIndex, type L2Book, type Candle, type CandleInterval, type FundingHistoryRow, INTERVAL_MS } from '@strike/hyperliquid'
import { SharedCache, CoinGeckoClient } from '@strike/coingecko'
import { toSnaps, SnapshotHistory, type MarketSnap } from '@strike/market-intelligence'
import { AssetRegistry } from '@strike/asset-registry'

export interface MarketData {
  snaps: MarketSnap[]; meta: MetaIndex; ts: number; stale: boolean; env: 'mainnet' | 'testnet'
}

/** Shared public-market cache: ONE upstream request per key regardless of how many users are viewing (tenant-agnostic data only). */
export class MarketService {
  readonly cache: SharedCache
  readonly history = new SnapshotHistory()
  readonly registry = new AssetRegistry()
  readonly upstream = { hlCalls: 0, hlErrors: 0, lastError: null as string | null }
  constructor(readonly mainnet: InfoClient, readonly testnet: InfoClient, readonly cg: CoinGeckoClient, private readonly now: () => number = Date.now) {
    this.cache = new SharedCache({ now })
  }
  private async hl<T>(key: string, ttl: number, f: () => Promise<T>) {
    return this.cache.getOrFetch<T>(key, ttl, async () => {
      this.upstream.hlCalls++
      try { return await f() } catch (e) { this.upstream.hlErrors++; this.upstream.lastError = String((e as Error).message); throw e }
    })
  }
  async markets(env: 'mainnet' | 'testnet' = 'mainnet'): Promise<MarketData> {
    const c = env === 'mainnet' ? this.mainnet : this.testnet
    const r = await this.hl(`mac:${env}`, 5_000, () => c.metaAndAssetCtxs())
    const [meta, ctxs] = r.value
    const snaps = toSnaps(meta.universe, ctxs, r.fetchedAt, env)
    if (env === 'mainnet') { this.history.record(snaps); this.registry.setLivePerps(snaps.map((s) => s.coin)) }
    return { snaps, meta: new MetaIndex(env, meta.universe), ts: r.fetchedAt, stale: r.stale, env }
  }
  /** Display book (shared cache ≤2s). For EXECUTION use freshBook() which bypasses the cache. */
  async book(coin: string, env: 'mainnet' | 'testnet' = 'mainnet'): Promise<L2Book> {
    const c = env === 'mainnet' ? this.mainnet : this.testnet
    return (await this.hl(`book:${env}:${coin}`, 2_000, () => c.l2Book(coin))).value
  }
  async freshBook(coin: string, env: 'mainnet' | 'testnet'): Promise<L2Book> { this.upstream.hlCalls++; return (env === 'mainnet' ? this.mainnet : this.testnet).l2Book(coin) }
  async candles(coin: string, interval: CandleInterval, n = 96, env: 'mainnet' | 'testnet' = 'mainnet'): Promise<Candle[]> {
    const c = env === 'mainnet' ? this.mainnet : this.testnet
    const span = INTERVAL_MS[interval] * n
    const ttl = Math.min(60_000, INTERVAL_MS[interval] / 2)
    return (await this.hl(`candles:${env}:${coin}:${interval}:${n}`, ttl, () => c.candleSnapshot(coin, interval, this.now() - span))).value
  }
  async fundingHistory(coin: string, hours = 48): Promise<FundingHistoryRow[]> {
    return (await this.hl(`funding:${coin}:${hours}`, 5 * 60e3, () => this.mainnet.fundingHistory(coin, this.now() - hours * 3600e3))).value
  }
  async trendingPerps(): Promise<{ list: Array<{ coin: string; cgId: string; rank: number; status: string; name: string }>; fetchedAt: number | null; stale: boolean; error: string | null }> {
    try {
      const t = await this.cg.trending()
      const list = t.data.coins.map((c, rank) => {
        const m = this.registry.resolve({ id: c.item.id, symbol: c.item.symbol, name: c.item.name })
        return { coin: m.hlPerp ?? c.item.symbol.toUpperCase(), cgId: c.item.id, rank, status: m.status, name: c.item.name }
      })
      return { list, fetchedAt: t.fetchedAt, stale: t.stale, error: null }
    } catch (e) { return { list: [], fetchedAt: null, stale: true, error: String((e as Error).message) } }
  }
}
