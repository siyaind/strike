import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })

export { Decimal }
export type Num = Decimal.Value

export const D = (v: Num): Decimal => new Decimal(v)

/** Strip trailing zeros the way Hyperliquid's wire format requires ("1.50" -> "1.5", "2.0" -> "2"). */
export function toWire(v: Num): string {
  const d = D(v)
  if (d.isZero()) return '0'
  let s = d.toFixed()
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

export function pct(part: Num, whole: Num): Decimal {
  const w = D(whole)
  if (w.isZero()) return D(0)
  return D(part).div(w).mul(100)
}

export function bps(part: Num, whole: Num): Decimal {
  const w = D(whole)
  if (w.isZero()) return D(0)
  return D(part).div(w).mul(10_000)
}

export function fmtUsd(v: Num, dp = 2): string {
  const d = D(v)
  const sign = d.isNeg() ? '-' : ''
  const abs = d.abs()
  if (abs.gte(1e9)) return `${sign}$${abs.div(1e9).toFixed(2)}B`
  if (abs.gte(1e6)) return `${sign}$${abs.div(1e6).toFixed(2)}M`
  if (abs.gte(1e4)) return `${sign}$${abs.div(1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(dp)}`
}

/** Price formatter that keeps ~5 significant figures, matching Hyperliquid's price precision. */
export function fmtPx(v: Num): string {
  const d = D(v)
  if (d.isZero()) return '0'
  const abs = d.abs()
  if (abs.gte(10000)) return d.toFixed(0)
  return toWire(d.toSignificantDigits(5))
}
