import type { MarketSnap, SnapshotHistory } from './snapshot'
import { percentileRank } from './stats'

export type RadarCategory = 'positions' | 'watchlist' | 'trending' | 'movers' | 'funding' | 'oi-change' | 'liquidity-change' | 'volume' | 'new'
export const RADAR_CATEGORIES: RadarCategory[] = ['positions', 'watchlist', 'trending', 'movers', 'funding', 'oi-change', 'liquidity-change', 'volume', 'new']

export interface RadarConfig {
  moverPct: number // |24h change| threshold
  fundingHourly: number // |hourly funding| threshold
  oiChangePct: number
  liquidityChangePct: number
  minDayVolumeUsd: number // eligibility floor
  topVolumeN: number
  comparisonWindowMs: number
}
export const DEFAULT_RADAR: RadarConfig = { moverPct: 5, fundingHourly: 0.0001, oiChangePct: 5, liquidityChangePct: 25, minDayVolumeUsd: 1_000_000, topVolumeN: 8, comparisonWindowMs: 60 * 60e3 }

export interface RadarReason { category: RadarCategory; text: string; weight: number }
export interface RadarPoint {
  coin: string
  /** x ∈ [-1,1]: 24h change clipped to ±(2×moverPct) — documented linear scale. */
  x: number
  /** y ∈ [0,1]: percentile rank of 24h notional volume within the eligible universe. */
  y: number
  /** size ∈ [0,1]: percentile rank of open-interest notional. */
  size: number
  isPosition: boolean
  isWatch: boolean
  warning: boolean
  score: number
  reasons: RadarReason[]
  snap: MarketSnap
  mapping: 'verified' | 'research-only' | 'n/a'
}

export interface RadarInput {
  snaps: MarketSnap[]
  history?: SnapshotHistory
  positions?: string[]
  watchlist?: string[]
  trendingPerps?: Array<{ coin: string; cgId: string; rank: number }>
  verifiedPerps?: Set<string>
  now: number
  config?: Partial<RadarConfig>
}

const W: Record<RadarCategory, number> = { positions: 100, watchlist: 40, trending: 30, movers: 25, funding: 20, 'oi-change': 20, 'liquidity-change': 15, volume: 10, new: 15 }

/** Deterministic, transparent ranking. Score = Σ category weight × magnitude factor (documented in docs/RADAR.md / PRODUCT-SPEC). No predictions. */
export function buildRadar(input: RadarInput): { points: RadarPoint[]; byCategory: Record<RadarCategory, RadarPoint[]>; config: RadarConfig; observationStart: number | null; ts: number } {
  const cfg = { ...DEFAULT_RADAR, ...input.config }
  const pos = new Set((input.positions ?? []).map((c) => c.toUpperCase()))
  const watch = new Set((input.watchlist ?? []).map((c) => c.toUpperCase()))
  const trending = new Map((input.trendingPerps ?? []).map((t) => [t.coin.toUpperCase(), t]))
  const eligible = input.snaps.filter((s) => s.dayNtlVlm >= cfg.minDayVolumeUsd || pos.has(s.coin.toUpperCase()) || watch.has(s.coin.toUpperCase()))
  const vols = eligible.map((s) => s.dayNtlVlm)
  const ois = eligible.map((s) => s.oiNotional)
  const topVol = new Set([...eligible].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm).slice(0, cfg.topVolumeN).map((s) => s.coin))

  const points: RadarPoint[] = eligible.map((s) => {
    const C = s.coin.toUpperCase()
    const reasons: RadarReason[] = []
    if (pos.has(C)) reasons.push({ category: 'positions', text: 'You hold a position in this market', weight: W.positions })
    if (watch.has(C)) reasons.push({ category: 'watchlist', text: 'On your watchlist', weight: W.watchlist })
    const t = trending.get(C)
    if (t) reasons.push({ category: 'trending', text: `Trending on CoinGecko (#${t.rank + 1})`, weight: W.trending * (1 - t.rank / 20) })
    if (s.change24hPct != null && Math.abs(s.change24hPct) >= cfg.moverPct) reasons.push({ category: 'movers', text: `${s.change24hPct > 0 ? 'Up' : 'Down'} ${Math.abs(s.change24hPct).toFixed(1)}% vs 24h-ago price (threshold ${cfg.moverPct}%)`, weight: W.movers * Math.min(3, Math.abs(s.change24hPct) / cfg.moverPct) })
    if (Math.abs(s.fundingHourly) >= cfg.fundingHourly) reasons.push({ category: 'funding', text: `Funding ${(s.fundingHourly * 100).toFixed(4)}%/h — ${s.fundingHourly > 0 ? 'longs pay shorts' : 'shorts pay longs'} (threshold ${(cfg.fundingHourly * 100).toFixed(4)}%/h)`, weight: W.funding * Math.min(3, Math.abs(s.fundingHourly) / cfg.fundingHourly) })
    if (topVol.has(s.coin)) reasons.push({ category: 'volume', text: `Top ${cfg.topVolumeN} by 24h notional volume ($${(s.dayNtlVlm / 1e6).toFixed(1)}M)`, weight: W.volume })
    const prior = input.history?.prior(s.coin, input.now, cfg.comparisonWindowMs)
    if (prior) {
      const d = prior.oiNotional > 0 ? ((s.oiNotional - prior.oiNotional) / prior.oiNotional) * 100 : 0
      if (Math.abs(d) >= cfg.oiChangePct) reasons.push({ category: 'oi-change', text: `Open interest ${d > 0 ? '+' : ''}${d.toFixed(1)}% since STRIKE's observation ${Math.round((input.now - prior.ts) / 60e3)}m ago`, weight: W['oi-change'] * Math.min(3, Math.abs(d) / cfg.oiChangePct) })
      if (prior.impactSpreadBps && s.impactSpreadBps) {
        const l = ((s.impactSpreadBps - prior.impactSpreadBps) / prior.impactSpreadBps) * 100
        if (Math.abs(l) >= cfg.liquidityChangePct) reasons.push({ category: 'liquidity-change', text: `Impact spread ${l > 0 ? 'widened' : 'tightened'} ${Math.abs(l).toFixed(0)}% (${prior.impactSpreadBps.toFixed(1)}→${s.impactSpreadBps.toFixed(1)} bp)`, weight: W['liquidity-change'] })
      }
    }
    if (input.history?.isNew(s.coin, 7 * 24 * 3600e3, input.now)) reasons.push({ category: 'new', text: 'Listed since STRIKE began observing', weight: W.new })
    const x = s.change24hPct == null ? 0 : Math.max(-1, Math.min(1, s.change24hPct / (2 * cfg.moverPct)))
    return {
      coin: s.coin, x, y: percentileRank(vols, s.dayNtlVlm), size: percentileRank(ois, s.oiNotional),
      isPosition: pos.has(C), isWatch: watch.has(C), warning: reasons.some((r) => r.category === 'funding'),
      score: Math.round(reasons.reduce((a, r) => a + r.weight, 0) * 100) / 100, reasons, snap: s,
      mapping: input.verifiedPerps ? (input.verifiedPerps.has(C) ? 'verified' : 'research-only') : 'n/a',
    }
  })
  points.sort((a, b) => b.score - a.score || b.snap.dayNtlVlm - a.snap.dayNtlVlm || a.coin.localeCompare(b.coin))
  const byCategory = Object.fromEntries(RADAR_CATEGORIES.map((c) => [c, points.filter((p) => p.reasons.some((r) => r.category === c))])) as Record<RadarCategory, RadarPoint[]>
  return { points: points.filter((p) => p.score > 0), byCategory, config: cfg, observationStart: input.history?.observationStart() ?? null, ts: input.now }
}

export function explainRadar(p: RadarPoint): string {
  if (!p.reasons.length) return `${p.coin} has no active radar reasons.`
  return `${p.coin}: ${p.reasons.map((r) => r.text).join('; ')}.`
}
