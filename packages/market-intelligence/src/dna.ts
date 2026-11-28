import type { MarketSnap } from './snapshot'
import { percentileRank, realizedVol } from './stats'

export type DnaDim = 'momentum' | 'volume' | 'liquidity' | 'volatility' | 'funding' | 'openInterest'
export const DNA_DIMS: DnaDim[] = ['momentum', 'volume', 'liquidity', 'volatility', 'funding', 'openInterest']
export interface DnaAxis {
  dim: DnaDim; label: string
  score: number | null // 0..1 ; null = unavailable (never invented)
  raw: string; source: string; ts: number; method: string; explanation: string
}
export interface MarketDna { coin: string; axes: DnaAxis[]; narrative: string; ts: number; universeSize: number }

const VOL_CAP = 1.5 // 150% annualised maps to 1.0

/** Market DNA. Cross-sectional percentile vs. the eligible Hyperliquid universe at the same timestamp, except volatility (fixed documented scale). */
export function marketDna(coin: string, universe: MarketSnap[], hourlyCloses: number[] | null, now: number): MarketDna {
  const s = universe.find((u) => u.coin === coin)
  if (!s) throw new Error(`No snapshot for ${coin}`)
  const pr = (f: (x: MarketSnap) => number | null) => percentileRank(universe.map(f).filter((v): v is number => v != null), f(s) ?? NaN)
  const vol = hourlyCloses ? realizedVol(hourlyCloses, 3600e3) : null
  const liq = s.impactSpreadBps
  const hl = `hyperliquid-${s.env}`
  const axes: DnaAxis[] = [
    { dim: 'momentum', label: 'Momentum', score: s.change24hPct == null ? null : pr((x) => x.change24hPct), raw: s.change24hPct == null ? 'unavailable' : `${s.change24hPct >= 0 ? '+' : ''}${s.change24hPct.toFixed(2)}% 24h`, source: `${hl} metaAndAssetCtxs (markPx vs prevDayPx)`, ts: s.ts, method: 'percentile rank of 24h % change across universe', explanation: 'Where this market\'s 24h move sits relative to all other perps. High = outperforming peers, not a forecast.' },
    { dim: 'volume', label: 'Volume', score: pr((x) => x.dayNtlVlm), raw: `$${(s.dayNtlVlm / 1e6).toFixed(2)}M 24h`, source: `${hl} dayNtlVlm`, ts: s.ts, method: 'percentile rank of 24h notional volume', explanation: 'Trading activity relative to other perps.' },
    { dim: 'liquidity', label: 'Liquidity', score: liq == null ? null : 1 - percentileRank(universe.map((x) => x.impactSpreadBps).filter((v): v is number => v != null), liq), raw: liq == null ? 'unavailable' : `${liq.toFixed(2)} bp impact spread`, source: `${hl} impactPxs`, ts: s.ts, method: '1 − percentile rank of impact spread (tighter = higher)', explanation: 'How tight the exchange-computed impact bid/ask is. Open Liquidity Lens for depth at your size.' },
    { dim: 'volatility', label: 'Volatility', score: vol == null ? null : Math.min(1, vol / VOL_CAP), raw: vol == null ? 'unavailable (needs ≥3 hourly candles)' : `${(vol * 100).toFixed(0)}% annualised`, source: `${hl} candleSnapshot 1h`, ts: now, method: `realised vol of hourly log returns, annualised, scaled linearly to ${VOL_CAP * 100}% = 1`, explanation: 'Higher volatility means larger swings in both directions — more opportunity and more risk.' },
    { dim: 'funding', label: 'Funding', score: pr((x) => Math.abs(x.fundingHourly)), raw: `${(s.fundingHourly * 100).toFixed(4)}%/h (${s.fundingHourly >= 0 ? 'longs pay' : 'shorts pay'})`, source: `${hl} funding`, ts: s.ts, method: 'percentile rank of |hourly funding|', explanation: 'Pressure magnitude, regardless of direction. Direction is shown in the raw value.' },
    { dim: 'openInterest', label: 'Open Int.', score: pr((x) => x.oiNotional), raw: `$${(s.oiNotional / 1e6).toFixed(2)}M`, source: `${hl} openInterest × oraclePx`, ts: s.ts, method: 'percentile rank of OI notional', explanation: 'Size of outstanding positions relative to other perps.' },
  ]
  return { coin, axes, narrative: narrative(s, vol), ts: now, universeSize: universe.length }
}

/** Deterministic, source-aware template. No LLM, no invented facts. */
export function narrative(s: MarketSnap, vol: number | null): string {
  const parts: string[] = []
  if (s.change24hPct != null) parts.push(`${s.coin} is ${s.change24hPct >= 0 ? 'up' : 'down'} ${Math.abs(s.change24hPct).toFixed(1)}% over 24h.`)
  if (s.fundingHourly > 0) parts.push('Funding is positive: longs pay shorts.')
  else if (s.fundingHourly < 0) parts.push('Funding is negative: shorts pay longs.')
  else parts.push('Funding is flat.')
  if (vol != null) parts.push(`Realised volatility ≈${(vol * 100).toFixed(0)}% annualised.`)
  if (s.impactSpreadBps != null) parts.push(`Impact spread ${s.impactSpreadBps.toFixed(1)} bp.`)
  return parts.join(' ')
}
