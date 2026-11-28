import { D, Decimal, toWire, type Num } from '@strike/shared'

export const MAX_DECIMALS = { perp: 6, spot: 8 } as const

export class PrecisionError extends Error {}

/** Max decimals for a price: MAX_DECIMALS - szDecimals (docs: tick-and-lot-size). */
export function priceDecimals(kind: 'perp' | 'spot', szDecimals: number) {
  return Math.max(0, MAX_DECIMALS[kind] - szDecimals)
}

/** Round a price to a valid tick: ≤5 significant figures and ≤ (MAX_DECIMALS - szDecimals) decimals; integers always valid.
 * `direction` chooses rounding so that bounded orders never become MORE aggressive than the user approved. */
export function roundPrice(px: Num, kind: 'perp' | 'spot', szDecimals: number, direction: 'down' | 'up' | 'nearest' = 'nearest'): string {
  const d = D(px)
  if (!d.isFinite() || d.lte(0)) throw new PrecisionError(`Invalid price ${px}`)
  const mode = direction === 'down' ? Decimal.ROUND_DOWN : direction === 'up' ? Decimal.ROUND_UP : Decimal.ROUND_HALF_EVEN
  if (d.isInteger() && d.gte(1e5)) return toWire(d)
  let r = d.toSignificantDigits(5, mode)
  r = r.toDecimalPlaces(priceDecimals(kind, szDecimals), mode)
  if (r.lte(0)) throw new PrecisionError(`Price ${px} rounds to zero`)
  return toWire(r)
}

export function isValidPrice(px: string, kind: 'perp' | 'spot', szDecimals: number): boolean {
  const d = D(px)
  if (!d.isFinite() || d.lte(0)) return false
  if (d.isInteger()) return true
  if (d.decimalPlaces() > priceDecimals(kind, szDecimals)) return false
  return d.sd(false) <= 5
}

/** Round size DOWN to szDecimals so rounding never silently increases exposure. */
export function roundSizeDown(sz: Num, szDecimals: number): string {
  const r = D(sz).toDecimalPlaces(szDecimals, Decimal.ROUND_DOWN)
  return toWire(r)
}

export function isValidSize(sz: string, szDecimals: number): boolean {
  const d = D(sz)
  return d.isFinite() && d.gt(0) && d.decimalPlaces() <= szDecimals
}
