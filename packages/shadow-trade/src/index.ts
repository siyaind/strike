import { estimateFill } from '@strike/market-intelligence'
import type { L2Book } from '@strike/hyperliquid'

export const SCENARIOS_PCT = [-10, -5, -2, 0, 2, 5, 10] as const
/** Hyperliquid base-tier perp fees (docs: trading/fees, tier 0): taker 0.045%, maker 0.015%. Replaced by userFees when an account is connected. */
export const DEFAULT_FEES = { taker: 0.00045, maker: 0.00015, source: 'Hyperliquid fee schedule, base tier (default)' }

export interface ShadowInput {
  coin: string; side: 'long' | 'short'; action: 'open' | 'increase' | 'reduce'
  notionalUsd: number; leverage: number
  markPx: number; oraclePx: number; fundingHourly: number; szDecimals: number
  book: L2Book | null; now: number
  existing: { szi: number; entryPx: number } | null // signed size
  otherExposureUsd: number
  accountValueUsd: number | null
  riskBudgetUsd: number
  feeRate?: { taker: number; source: string }
}
export interface ShadowResult {
  coin: string; side: 'long' | 'short'; action: ShadowInput['action']
  notionalUsd: number; qty: number; estEntryPx: number | null; entrySource: 'book-vwap' | 'unavailable'
  estImpactBps: number | null; visibleLiquiditySufficient: boolean
  estFeeUsd: number; feeSource: string
  initialMarginUsd: number
  exposureNowUsd: number; exposureAfterUsd: number; sziAfter: number
  portfolioExposureAfterUsd: number
  fundingPerHourUsd: number // positive = user pays
  riskBudgetPct: number
  scenarios: Array<{ pct: number; price: number; pnlChangeUsd: number }>
  liquidationAfter: null; liquidationNote: string
  labels: string[]; bookAgeMs: number | null; ts: number
}

/** Non-executable simulation. Never changes account state and never produces an order. */
export function shadowTrade(i: ShadowInput): ShadowResult {
  const buy = (i.side === 'long') !== (i.action === 'reduce')
  const est = i.book ? estimateFill(i.book, buy ? 'buy' : 'sell', i.notionalUsd) : null
  const px = est?.vwap ?? null
  const step = 10 ** -i.szDecimals
  const qtyRaw = i.notionalUsd / (px ?? i.markPx)
  let qty = Math.floor(qtyRaw / step + 1e-9) * step
  const cur = i.existing?.szi ?? 0
  if (i.action === 'reduce') qty = Math.min(qty, Math.abs(cur)) // never reverse
  const signed = buy ? qty : -qty
  const sziAfter = cur + signed
  const fee = qty * (px ?? i.markPx) * (i.feeRate?.taker ?? DEFAULT_FEES.taker)
  const exposureNow = Math.abs(cur) * i.markPx
  const exposureAfter = Math.abs(sziAfter) * i.markPx
  const initialMargin = exposureAfter / i.leverage
  return {
    coin: i.coin, side: i.side, action: i.action, notionalUsd: i.notionalUsd, qty, estEntryPx: px, entrySource: px ? 'book-vwap' : 'unavailable',
    estImpactBps: est?.slippageBps ?? null, visibleLiquiditySufficient: est?.sufficient ?? false,
    estFeeUsd: fee, feeSource: i.feeRate?.source ?? DEFAULT_FEES.source, initialMarginUsd: initialMargin,
    exposureNowUsd: exposureNow, exposureAfterUsd: exposureAfter, sziAfter,
    portfolioExposureAfterUsd: i.otherExposureUsd + exposureAfter,
    fundingPerHourUsd: sziAfter * i.oraclePx * i.fundingHourly,
    riskBudgetPct: i.riskBudgetUsd > 0 ? (initialMargin / i.riskBudgetUsd) * 100 : 0,
    scenarios: SCENARIOS_PCT.map((pct) => ({ pct, price: i.markPx * (1 + pct / 100), pnlChangeUsd: sziAfter * i.markPx * (pct / 100) })),
    liquidationAfter: null,
    liquidationNote: 'Post-trade liquidation price is not estimated: it depends on cross-margin state and exchange margin tiers. The exchange-reported value is shown after execution.',
    labels: ['SIMULATION', 'ESTIMATE — not an exchange quote', 'Scenario PnL is change in unrealised PnL from current mark, not a forecast'],
    bookAgeMs: i.book ? i.now - i.book.time : null, ts: i.now,
  }
}
