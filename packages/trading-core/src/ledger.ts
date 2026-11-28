import type { L2Book } from '@strike/hyperliquid'

/** Guest-only simulated ledger. Fills are computed locally against the live public book. NEVER touches signed endpoints. */
export interface SimPosition { coin: string; szi: number; entryPx: number; leverage: number; stopPx: number | null; takeProfitPx: number | null; openedAt: number }
export interface SimFill { id: string; coin: string; side: 'buy' | 'sell'; px: number; sz: number; fee: number; time: number; label: 'SIMULATED EXECUTION'; proposalId: string; closedPnl: number }
export class SimLedgerError extends Error {}

export class SimulatedLedger {
  cash: number
  positions = new Map<string, SimPosition>()
  fills: SimFill[] = []
  private seq = 0
  constructor(startingCash = 10_000, readonly feeRate = 0.00045) { this.cash = startingCash }

  /** Walk the visible book within the approved bound; partial fills if bound/visible depth runs out (IOC semantics). */
  execute(args: { proposalId: string; coin: string; isBuy: boolean; sz: number; limitPx: number; reduceOnly: boolean; leverage: number; book: L2Book; now: number; protection?: { stopPx: number | null; takeProfitPx: number | null } }): { filledSz: number; avgPx: number | null; status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED'; reason?: string } {
    const levels = args.isBuy ? args.book.levels[1] : args.book.levels[0]
    const pos = this.positions.get(args.coin)
    let want = args.sz
    if (args.reduceOnly) {
      if (!pos || pos.szi === 0) return { filledSz: 0, avgPx: null, status: 'REJECTED', reason: 'Reduce-only with no position' }
      if ((pos.szi > 0) === args.isBuy) return { filledSz: 0, avgPx: null, status: 'REJECTED', reason: 'Reduce-only would increase position' }
      want = Math.min(want, Math.abs(pos.szi))
    }
    let filled = 0, notional = 0
    for (const l of levels) {
      const px = Number(l.px), sz = Number(l.sz)
      if (args.isBuy ? px > args.limitPx : px < args.limitPx) break
      const take = Math.min(sz, want - filled)
      filled += take; notional += take * px
      if (filled >= want - 1e-12) break
    }
    if (filled <= 0) return { filledSz: 0, avgPx: null, status: 'REJECTED', reason: 'No visible liquidity within the approved price bound' }
    const avg = notional / filled
    const fee = notional * this.feeRate
    const signed = args.isBuy ? filled : -filled
    let closedPnl = 0
    if (!pos || pos.szi === 0) {
      this.positions.set(args.coin, { coin: args.coin, szi: signed, entryPx: avg, leverage: args.leverage, stopPx: args.protection?.stopPx ?? null, takeProfitPx: args.protection?.takeProfitPx ?? null, openedAt: args.now })
    } else if (Math.sign(pos.szi) === Math.sign(signed)) {
      pos.entryPx = (pos.entryPx * Math.abs(pos.szi) + avg * filled) / (Math.abs(pos.szi) + filled); pos.szi += signed
    } else {
      closedPnl = (avg - pos.entryPx) * Math.min(filled, Math.abs(pos.szi)) * Math.sign(pos.szi)
      pos.szi += signed
      if (Math.abs(pos.szi) < 1e-12) this.positions.delete(args.coin)
    }
    this.cash += closedPnl - fee
    this.fills.push({ id: `simfill_${++this.seq}`, coin: args.coin, side: args.isBuy ? 'buy' : 'sell', px: avg, sz: filled, fee, time: args.now, label: 'SIMULATED EXECUTION', proposalId: args.proposalId, closedPnl })
    return { filledSz: filled, avgPx: avg, status: filled >= want - 1e-12 ? 'FILLED' : 'PARTIALLY_FILLED' }
  }
  setProtection(coin: string, stopPx: number | null, tpPx: number | null) { const p = this.positions.get(coin); if (!p) throw new SimLedgerError('No position'); p.stopPx = stopPx; p.takeProfitPx = tpPx }
  /** Simulated liquidation price (isolated-margin approximation, labelled SIMULATED): entry × (1 ∓ 1/leverage × (1 − mmr)). */
  simLiqPx(p: SimPosition, maintenanceRate = 0.5 / Math.max(1, p.leverage) / 1) { const m = (1 / p.leverage) * (1 - maintenanceRate); return p.szi > 0 ? p.entryPx * (1 - m) : p.entryPx * (1 + m) }
}
