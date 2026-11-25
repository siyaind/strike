import { FUNDING_INTERVAL_MS, type FundingHistoryRow } from '@strike/hyperliquid'

export interface FundingClock {
  coin: string
  rateHourly: number
  direction: 'longs-pay-shorts' | 'shorts-pay-longs' | 'flat'
  nextFundingAt: number; msToNext: number
  scheduleSource: string
  positionSzi: number | null // signed, base units
  estNextPaymentUsd: number | null // positive = user pays
  horizons: Array<{ label: string; hours: number; estCostUsd: number | null }>
  assumption: string
  history: Array<{ time: number; rate: number }>
  historyStats: { mean: number; min: number; max: number; n: number } | null
  realized: { totalUsd: number; count: number; since: number } | null
  ts: number
}

/** Hyperliquid pays funding every hour on the hour (docs: trading/funding). */
export function nextFundingTime(now: number) { return Math.floor(now / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS + FUNDING_INTERVAL_MS }

/** Payment = position_size × oracle_price × funding_rate (docs formula). Positive result = the user PAYS. */
export function fundingPayment(szi: number, oraclePx: number, rate: number) { return szi * oraclePx * rate }

export function fundingClock(args: { coin: string; rateHourly: number; oraclePx: number; now: number; szi?: number | null; history?: FundingHistoryRow[]; userFundings?: Array<{ time: number; usdc: string; coin: string }>; sessionStart?: number }): FundingClock {
  const { coin, rateHourly, oraclePx, now } = args
  const szi = args.szi ?? null
  const next = nextFundingTime(now)
  const est = szi == null ? null : fundingPayment(szi, oraclePx, rateHourly)
  const hist = (args.history ?? []).map((h) => ({ time: h.time, rate: Number(h.fundingRate) }))
  const rs = hist.map((h) => h.rate)
  const realizedRows = (args.userFundings ?? []).filter((u) => u.coin === coin && u.time >= (args.sessionStart ?? 0))
  return {
    coin, rateHourly,
    direction: rateHourly > 0 ? 'longs-pay-shorts' : rateHourly < 0 ? 'shorts-pay-longs' : 'flat',
    nextFundingAt: next, msToNext: next - now, scheduleSource: 'Hyperliquid docs: funding paid every hour',
    positionSzi: szi, estNextPaymentUsd: est,
    horizons: [{ label: '1 interval', hours: 1 }, { label: '8h', hours: 8 }, { label: '24h', hours: 24 }, { label: '7d', hours: 168 }].map((h) => ({ ...h, estCostUsd: est == null ? null : est * h.hours })),
    assumption: 'Horizon estimates assume the CURRENT rate and oracle price stay constant. Real funding changes every hour; these are not guaranteed costs.',
    history: hist,
    historyStats: rs.length ? { mean: rs.reduce((a, b) => a + b, 0) / rs.length, min: Math.min(...rs), max: Math.max(...rs), n: rs.length } : null,
    // userFunding usdc is from the exchange's perspective (negative = user paid). We flip to "positive = paid" for display.
    realized: args.userFundings ? { totalUsd: -realizedRows.reduce((a, r) => a + Number(r.usdc), 0), count: realizedRows.length, since: args.sessionStart ?? 0 } : null,
    ts: now,
  }
}
