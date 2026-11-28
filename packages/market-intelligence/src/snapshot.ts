import type { PerpAssetCtx, PerpAssetMeta } from '@strike/hyperliquid'

/** Normalised per-market snapshot derived only from Hyperliquid metaAndAssetCtxs. */
export interface MarketSnap {
  coin: string
  markPx: number
  midPx: number | null
  oraclePx: number
  prevDayPx: number
  change24hPct: number | null
  dayNtlVlm: number
  openInterest: number // base units
  oiNotional: number // openInterest * oraclePx
  fundingHourly: number // HL funding rate per 1h interval
  impactSpreadBps: number | null
  maxLeverage: number
  szDecimals: number
  ts: number
  env: 'mainnet' | 'testnet'
}

export function toSnaps(universe: PerpAssetMeta[], ctxs: PerpAssetCtx[], ts: number, env: 'mainnet' | 'testnet'): MarketSnap[] {
  const out: MarketSnap[] = []
  universe.forEach((m, i) => {
    const c = ctxs[i]
    if (!c || m.isDelisted) return
    const mark = Number(c.markPx), prev = Number(c.prevDayPx), oracle = Number(c.oraclePx)
    const mid = c.midPx != null ? Number(c.midPx) : null
    let impact: number | null = null
    if (c.impactPxs && c.impactPxs.length === 2 && mid) {
      const [b, a] = c.impactPxs.map(Number) as [number, number]
      if (b > 0 && a > 0) impact = ((a - b) / mid) * 1e4
    }
    if (!(mark > 0)) return
    out.push({
      coin: m.name, markPx: mark, midPx: mid, oraclePx: oracle, prevDayPx: prev,
      change24hPct: prev > 0 ? ((mark - prev) / prev) * 100 : null,
      dayNtlVlm: Number(c.dayNtlVlm), openInterest: Number(c.openInterest), oiNotional: Number(c.openInterest) * oracle,
      fundingHourly: Number(c.funding), impactSpreadBps: impact, maxLeverage: m.maxLeverage, szDecimals: m.szDecimals, ts, env,
    })
  })
  return out
}

/** STRIKE-observed history: we only compare against snapshots WE recorded. Nothing is back-filled or invented. */
export class SnapshotHistory {
  private byCoin = new Map<string, MarketSnap[]>()
  private firstSeen = new Map<string, number>()
  private bootTs: number | null = null
  constructor(private readonly maxPerCoin = 288) {}
  record(snaps: MarketSnap[]) {
    for (const s of snaps) {
      if (this.bootTs == null) this.bootTs = s.ts
      const arr = this.byCoin.get(s.coin) ?? []
      if (arr.length && arr[arr.length - 1]!.ts === s.ts) continue
      arr.push(s); if (arr.length > this.maxPerCoin) arr.shift()
      this.byCoin.set(s.coin, arr)
      if (!this.firstSeen.has(s.coin)) this.firstSeen.set(s.coin, s.ts)
    }
  }
  /** Most recent snapshot at least `minAgeMs` older than `now`, or null when we have not observed that far back. */
  prior(coin: string, now: number, minAgeMs: number): MarketSnap | null {
    const arr = this.byCoin.get(coin) ?? []
    for (let i = arr.length - 1; i >= 0; i--) if (now - arr[i]!.ts >= minAgeMs) return arr[i]!
    return null
  }
  series(coin: string) { return [...(this.byCoin.get(coin) ?? [])] }
  /** A coin is "newly discovered" only if it first appeared AFTER our first observation of the universe. */
  isNew(coin: string, withinMs: number, now: number) {
    const f = this.firstSeen.get(coin)
    return f != null && this.bootTs != null && f > this.bootTs && now - f <= withinMs
  }
  observationStart() { return this.bootTs }
}
