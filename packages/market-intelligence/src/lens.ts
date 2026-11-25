import type { L2Book } from '@strike/hyperliquid'

export interface DepthPoint { px: number; cumSz: number; cumNotional: number; distBps: number }
export interface LensEstimate {
  side: 'buy' | 'sell'; notionalUsd: number
  filledNotional: number; filledSz: number
  vwap: number | null; worstPx: number | null
  slippageBps: number | null // vs mid
  sufficient: boolean
  levelsConsumed: number
}
export interface LiquidityLens {
  coin: string; bookTs: number; ageMs: number
  bestBid: number | null; bestAsk: number | null; mid: number | null; spreadBps: number | null
  bids: DepthPoint[]; asks: DepthPoint[]
  bands: Array<{ bps: number; bidNotional: number; askNotional: number }>
  estimates: LensEstimate[]
  empty: boolean
}
export const SIZE_PRESETS = [50, 100, 250, 500, 1000] as const
export const BANDS_BPS = [10, 25, 50, 100] as const

function cum(levels: { px: string; sz: string }[], mid: number): DepthPoint[] {
  let s = 0, n = 0
  return levels.map((l) => { const px = Number(l.px), sz = Number(l.sz); s += sz; n += px * sz; return { px, cumSz: s, cumNotional: n, distBps: mid ? (Math.abs(px - mid) / mid) * 1e4 : 0 } })
}

/** Walk visible levels only. Never extrapolate beyond the last visible level. */
export function estimateFill(book: L2Book, side: 'buy' | 'sell', notionalUsd: number): LensEstimate {
  const levels = side === 'buy' ? book.levels[1] : book.levels[0]
  const bb = book.levels[0][0] ? Number(book.levels[0][0].px) : null
  const ba = book.levels[1][0] ? Number(book.levels[1][0].px) : null
  const mid = bb != null && ba != null ? (bb + ba) / 2 : null
  let remaining = notionalUsd, filledN = 0, filledS = 0, worst: number | null = null, used = 0
  for (const l of levels) {
    if (remaining <= 1e-9) break
    const px = Number(l.px), sz = Number(l.sz)
    const take = Math.min(remaining, px * sz)
    filledN += take; filledS += take / px; remaining -= take; worst = px; used++
  }
  const vwap = filledS > 0 ? filledN / filledS : null
  const slippage = vwap != null && mid ? ((side === 'buy' ? vwap - mid : mid - vwap) / mid) * 1e4 : null
  return { side, notionalUsd, filledNotional: filledN, filledSz: filledS, vwap, worstPx: worst, slippageBps: slippage, sufficient: remaining <= 1e-6, levelsConsumed: used }
}

export function liquidityLens(book: L2Book, now: number, sizes: number[] = [...SIZE_PRESETS], side: 'buy' | 'sell' = 'buy'): LiquidityLens {
  const [bidsL, asksL] = book.levels
  const bestBid = bidsL[0] ? Number(bidsL[0].px) : null
  const bestAsk = asksL[0] ? Number(asksL[0].px) : null
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null
  const bids = cum(bidsL, mid ?? 0), asks = cum(asksL, mid ?? 0)
  const within = (pts: DepthPoint[], b: number) => pts.filter((p) => p.distBps <= b).reduce((a, p, i, arr) => (i === arr.length - 1 ? p.cumNotional : a), 0)
  return {
    coin: book.coin, bookTs: book.time, ageMs: now - book.time,
    bestBid, bestAsk, mid, spreadBps: mid && bestBid != null && bestAsk != null ? ((bestAsk - bestBid) / mid) * 1e4 : null,
    bids, asks,
    bands: BANDS_BPS.map((b) => ({ bps: b, bidNotional: within(bids, b), askNotional: within(asks, b) })),
    estimates: sizes.map((n) => estimateFill(book, side, n)),
    empty: !bidsL.length && !asksL.length,
  }
}
