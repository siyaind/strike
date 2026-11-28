/** Percentile rank in [0,1] of `x` within `xs` (fraction of values strictly below plus half of ties). */
export function percentileRank(xs: number[], x: number): number {
  const v = xs.filter((n) => Number.isFinite(n))
  if (v.length === 0) return 0.5
  let below = 0, eq = 0
  for (const n of v) { if (n < x) below++; else if (n === x) eq++ }
  return (below + eq / 2) / v.length
}
export function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return NaN
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2
}
/** Annualised realised volatility from close prices sampled every `intervalMs`. */
export function realizedVol(closes: number[], intervalMs: number): number | null {
  if (closes.length < 3) return null
  const r: number[] = []
  for (let i = 1; i < closes.length; i++) { const a = closes[i - 1]!, b = closes[i]!; if (a > 0 && b > 0) r.push(Math.log(b / a)) }
  if (r.length < 2) return null
  const mean = r.reduce((s, x) => s + x, 0) / r.length
  const varc = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1)
  const perYear = (365 * 24 * 3600e3) / intervalMs
  return Math.sqrt(varc * perYear)
}
