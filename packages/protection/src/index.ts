export type ProtectionState = 'NO_PROTECTION' | 'PROTECTION_PENDING' | 'PROTECTED' | 'PARTIALLY_PROTECTED' | 'UNPROTECTED' | 'PROTECTION_FAILED' | 'UNKNOWN'

export interface ExchangeOpenOrder { coin: string; oid: number; side: 'A' | 'B'; sz: string; isTrigger: boolean; triggerPx: string; reduceOnly: boolean; orderType: string; isPositionTpsl?: boolean }
export interface ProtectionStatus { state: ProtectionState; stop: { oid: number; triggerPx: number; sz: number } | null; takeProfit: { oid: number; triggerPx: number; sz: number } | null; coveredPct: number; duplicates: number[]; orphans: number[]; reasons: string[] }

const isStop = (o: ExchangeOpenOrder) => /stop/i.test(o.orderType)
const isTp = (o: ExchangeOpenOrder) => /take profit/i.test(o.orderType)

/** Derive protection ONLY from exchange-listed orders (frontendOpenOrders). Never PROTECTED without a verified order. */
export function deriveProtection(args: { coin: string; positionSzi: number | null; openOrders: ExchangeOpenOrder[] | null; pending?: boolean; lastSubmitFailed?: boolean }): ProtectionStatus {
  const { coin, positionSzi } = args
  const reasons: string[] = []
  if (args.openOrders == null || positionSzi == null) return { state: 'UNKNOWN', stop: null, takeProfit: null, coveredPct: 0, duplicates: [], orphans: [], reasons: ['Exchange order or position state unavailable'] }
  const mine = args.openOrders.filter((o) => o.coin === coin && o.isTrigger && o.reduceOnly)
  if (positionSzi === 0) {
    const orphans = mine.map((o) => o.oid)
    return { state: 'NO_PROTECTION', stop: null, takeProfit: null, coveredPct: 0, duplicates: [], orphans, reasons: orphans.length ? [`${orphans.length} reduce-only trigger order(s) remain with no position (orphans)`] : ['No position'] }
  }
  // A protective order must close (opposite side): long → sell (A), short → buy (B).
  const closeSide = positionSzi > 0 ? 'A' : 'B'
  const valid = mine.filter((o) => o.side === closeSide)
  const wrongSide = mine.filter((o) => o.side !== closeSide).map((o) => o.oid)
  const stops = valid.filter(isStop), tps = valid.filter(isTp)
  const pos = Math.abs(positionSzi)
  const sz = (o: ExchangeOpenOrder) => (o.isPositionTpsl && Number(o.sz) === 0 ? pos : Number(o.sz)) // positionTpsl orders carry sz 0 = whole position
  const stopCover = stops.reduce((a, o) => a + sz(o), 0)
  const dup = stops.length > 1 ? stops.slice(1).map((o) => o.oid) : []
  const best = stops[0]
  const tp = tps[0]
  let state: ProtectionState
  if (args.lastSubmitFailed && !stops.length) { state = 'PROTECTION_FAILED'; reasons.push('Last protective order submission failed and no stop is listed') }
  else if (args.pending && !stops.length) state = 'PROTECTION_PENDING'
  else if (!stops.length) { state = 'UNPROTECTED'; reasons.push('Position open and no reduce-only stop order listed on exchange') }
  else if (stopCover + 1e-12 < pos) { state = 'PARTIALLY_PROTECTED'; reasons.push(`Stop covers ${((stopCover / pos) * 100).toFixed(0)}% of position`) }
  else state = 'PROTECTED'
  if (dup.length) reasons.push(`${dup.length} duplicate stop order(s)`)
  if (wrongSide.length) reasons.push('Trigger orders on the wrong side do not protect this position')
  if (state === 'PROTECTED') reasons.push('Verified from exchange open orders. A trigger does not guarantee execution at the trigger price (gaps, liquidity).')
  return { state, stop: best ? { oid: best.oid, triggerPx: Number(best.triggerPx), sz: sz(best) } : null, takeProfit: tp ? { oid: tp.oid, triggerPx: Number(tp.triggerPx), sz: sz(tp) } : null, coveredPct: Math.min(100, (stopCover / pos) * 100), duplicates: dup, orphans: wrongSide, reasons }
}

/** Build the reduce-only trigger order params for an existing position. Stop-market uses a bounded limit (slippage cap) as HL requires. */
export function protectiveOrderParams(args: { positionSzi: number; triggerPx: number; kind: 'sl' | 'tp'; slippageBps: number }) {
  if (args.positionSzi === 0) throw new Error('No position to protect')
  const isBuy = args.positionSzi < 0
  if (args.kind === 'sl' && ((args.positionSzi > 0 && args.triggerPx <= 0))) throw new Error('Invalid trigger')
  const limit = isBuy ? args.triggerPx * (1 + args.slippageBps / 1e4) : args.triggerPx * (1 - args.slippageBps / 1e4)
  return { isBuy, sz: Math.abs(args.positionSzi), triggerPx: args.triggerPx, limitPx: limit, reduceOnly: true as const, tpsl: args.kind, isMarket: true }
}

export function validateStopPlacement(side: 'long' | 'short', markPx: number, stopPx: number): string | null {
  if (side === 'long' && stopPx >= markPx) return 'Stop for a long must be below the current price'
  if (side === 'short' && stopPx <= markPx) return 'Stop for a short must be above the current price'
  return null
}
