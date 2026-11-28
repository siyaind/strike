import { systemClock, type Clock } from '@strike/shared'
import { SharedCache } from './cache'

/** Demo plan (verified 2026-11-25 on coingecko.com/en/api/pricing): 10,000 call credits/month, 100 calls/min.
 * STRIKE self-limits below the published ceiling. Keyless public API (no key) has a lower, unpublished-stable limit. */
export const DEMO_MONTHLY_CREDITS = 10_000
export const DEMO_PER_MINUTE = 100
/** STRIKE's own ceiling per minute (headroom under DEMO_PER_MINUTE). */
export const STRIKE_DEMO_PER_MINUTE = 60

export const TTL = {
  trending: 30 * 60e3,
  markets: 15 * 60e3,
  global: 15 * 60e3,
  categories: 60 * 60e3,
  coin: 6 * 60 * 60e3,
  search: 24 * 60 * 60e3,
  chart: 30 * 60e3,
} as const

export type CgMode = 'demo' | 'public' | 'disabled'
export class CgBudgetError extends Error { readonly code = 'CG_BUDGET_EXHAUSTED' }
export class CgCircuitOpenError extends Error { readonly code = 'CG_CIRCUIT_OPEN' }
export class CgHttpError extends Error { constructor(readonly status: number, msg: string) { super(msg) } }

export interface CgUsage { mode: CgMode; monthKey: string; callsThisMonth: number; monthlyBudget: number; callsLastMinute: number; perMinute: number; circuit: 'closed' | 'open' | 'half-open'; lastError: string | null; cacheEntries: number; hits: number; misses: number; dedupedJoins: number }

type F = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface CoinGeckoOptions { apiKey?: string | null; fetch?: F; clock?: Clock; monthlyBudget?: number; perMinute?: number; cache?: SharedCache }

export class CoinGeckoClient {
  readonly mode: CgMode
  readonly base: string
  private readonly f: F
  private readonly clock: Clock
  readonly cache: SharedCache
  private calls: number[] = []
  private monthKey = ''
  private monthCalls = 0
  private failures = 0
  private openedAt = 0
  private lastError: string | null = null
  private hits = 0
  private misses = 0
  private joins = 0
  private readonly monthlyBudget: number
  private readonly perMinute: number
  private readonly apiKey: string | null

  constructor(opts: CoinGeckoOptions = {}) {
    this.apiKey = opts.apiKey ?? null
    this.mode = this.apiKey ? 'demo' : 'public'
    // Demo keys use the same host as the public API with the x-cg-demo-api-key header.
    this.base = 'https://api.coingecko.com/api/v3'
    this.f = opts.fetch ?? (globalThis.fetch as unknown as F)
    this.clock = opts.clock ?? systemClock
    this.cache = opts.cache ?? new SharedCache(this.clock)
    this.monthlyBudget = opts.monthlyBudget ?? (this.mode === 'demo' ? DEMO_MONTHLY_CREDITS : 3_000)
    this.perMinute = opts.perMinute ?? (this.mode === 'demo' ? STRIKE_DEMO_PER_MINUTE : 5)
  }

  private rollMonth() {
    const d = new Date(this.clock.now())
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    if (k !== this.monthKey) { this.monthKey = k; this.monthCalls = 0 }
  }

  usage(): CgUsage {
    this.rollMonth()
    const now = this.clock.now()
    this.calls = this.calls.filter((t) => now - t < 60e3)
    return { mode: this.mode, monthKey: this.monthKey, callsThisMonth: this.monthCalls, monthlyBudget: this.monthlyBudget, callsLastMinute: this.calls.length, perMinute: this.perMinute, circuit: this.circuitState(), lastError: this.lastError, cacheEntries: this.cache.size(), hits: this.hits, misses: this.misses, dedupedJoins: this.joins }
  }

  private circuitState(): 'closed' | 'open' | 'half-open' {
    if (this.failures < 3) return 'closed'
    const cool = Math.min(60e3 * 2 ** (this.failures - 3), 15 * 60e3)
    return this.clock.now() - this.openedAt > cool ? 'half-open' : 'open'
  }

  /** Adaptive TTL: stretch TTLs as monthly budget is consumed so we never exhaust credits. */
  adaptiveTtl(base: number): number {
    const u = this.usage()
    const used = u.callsThisMonth / u.monthlyBudget
    if (used > 0.9) return base * 8
    if (used > 0.75) return base * 4
    if (used > 0.5) return base * 2
    return base
  }

  private async raw<T>(path: string): Promise<T> {
    this.rollMonth()
    const st = this.circuitState()
    if (st === 'open') throw new CgCircuitOpenError(`CoinGecko circuit open after ${this.failures} failures`)
    const now = this.clock.now()
    this.calls = this.calls.filter((t) => now - t < 60e3)
    if (this.monthCalls >= this.monthlyBudget) throw new CgBudgetError('Monthly CoinGecko budget reached; serving cache only')
    if (this.calls.length >= this.perMinute) throw new CgBudgetError('Per-minute CoinGecko limit reached; serving cache only')
    this.calls.push(now); this.monthCalls++
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey
    let res
    try { res = await this.f(`${this.base}${path}`, { headers }) } catch (e) { this.fail(String((e as Error).message)); throw e }
    if (!res.ok) { this.fail(`HTTP ${res.status}`); throw new CgHttpError(res.status, `CoinGecko HTTP ${res.status} for ${path.split('?')[0]}`) }
    this.failures = 0; this.lastError = null
    return (await res.json()) as T
  }
  private fail(msg: string) { this.failures++; this.lastError = msg; if (this.failures >= 3) this.openedAt = this.clock.now() }

  private async cached<T>(key: string, ttl: number, path: string) {
    const r = await this.cache.getOrFetch<T>(key, this.adaptiveTtl(ttl), () => this.raw<T>(path))
    if (r.fromCache && !r.stale) this.hits++; else this.misses++
    return { data: r.value, fetchedAt: r.fetchedAt, stale: r.stale, source: 'coingecko' as const }
  }

  trending() { return this.cached<{ coins: Array<{ item: { id: string; name: string; symbol: string; market_cap_rank: number | null; score: number; data?: { price?: number; price_change_percentage_24h?: Record<string, number>; total_volume?: string; market_cap?: string } } }> }>('trending', TTL.trending, '/search/trending') }
  /** Batch request: one call for many ids. */
  markets(ids: string[]) {
    const sorted = [...new Set(ids)].sort()
    return this.cached<Array<{ id: string; symbol: string; name: string; current_price: number; market_cap: number; total_volume: number; price_change_percentage_24h: number | null; market_cap_rank: number | null; last_updated: string }>>(`markets:${sorted.join(',')}`, TTL.markets, `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(sorted.join(','))}&per_page=250&page=1&price_change_percentage=24h`)
  }
  global() { return this.cached<{ data: { total_market_cap: Record<string, number>; total_volume: Record<string, number>; market_cap_change_percentage_24h_usd: number; market_cap_percentage: Record<string, number>; updated_at: number } }>('global', TTL.global, '/global') }
  categories() { return this.cached<Array<{ id: string; name: string; market_cap: number; market_cap_change_24h: number; volume_24h: number }>>('categories', TTL.categories, '/coins/categories') }
  coin(id: string) { return this.cached<{ id: string; symbol: string; name: string; platforms: Record<string, string>; categories: string[]; description?: { en?: string } }>(`coin:${id}`, TTL.coin, `/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`) }
  search(q: string) { return this.cached<{ coins: Array<{ id: string; name: string; symbol: string; market_cap_rank: number | null }> }>(`search:${q.toLowerCase()}`, TTL.search, `/search?query=${encodeURIComponent(q)}`) }
  marketChart(id: string, days: 1 | 7 | 30) { return this.cached<{ prices: [number, number][]; total_volumes: [number, number][] }>(`chart:${id}:${days}`, TTL.chart, `/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`) }
}

export const COINGECKO_ATTRIBUTION = { text: 'Market research data provided by CoinGecko', url: 'https://www.coingecko.com/en/api' } as const
