import { describe, expect, it } from 'vitest'
import { toSnaps, SnapshotHistory, type MarketSnap } from './snapshot'
import { buildRadar, explainRadar } from './radar'
import { marketDna } from './dna'
import { estimateFill, liquidityLens } from './lens'
import { fundingClock, fundingPayment, nextFundingTime } from './funding'
import { percentileRank, realizedVol } from './stats'

const T = Date.UTC(2026, 10, 25, 10, 41, 18)
const snap = (coin: string, o: Partial<MarketSnap> = {}): MarketSnap => ({ coin, markPx: 100, midPx: 100, oraclePx: 100, prevDayPx: 100, change24hPct: 0, dayNtlVlm: 5e6, openInterest: 1000, oiNotional: 1e5, fundingHourly: 0.0000125, impactSpreadBps: 2, maxLeverage: 20, szDecimals: 2, ts: T, env: 'mainnet', ...o })

describe('snapshots', () => {
  it('derives change, OI notional and impact spread from raw ctxs', () => {
    const s = toSnaps([{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'OLD', szDecimals: 1, maxLeverage: 3, isDelisted: true }], [
      { funding: '0.0000125', openInterest: '10', prevDayPx: '100000', dayNtlVlm: '1000000', premium: '0', oraclePx: '101000', markPx: '102000', midPx: '102000', impactPxs: ['101990', '102010'], dayBaseVlm: '10' },
      { funding: '0', openInterest: '0', prevDayPx: '1', dayNtlVlm: '0', premium: '0', oraclePx: '1', markPx: '1', midPx: '1', impactPxs: null, dayBaseVlm: '0' },
    ] as any, T, 'mainnet')
    expect(s).toHaveLength(1)
    expect(s[0]!.change24hPct).toBeCloseTo(2)
    expect(s[0]!.oiNotional).toBe(1_010_000)
    expect(s[0]!.impactSpreadBps).toBeCloseTo((20 / 102000) * 1e4)
  })
  it('history only compares against STRIKE-observed snapshots', () => {
    const h = new SnapshotHistory()
    expect(h.prior('BTC', T, 3600e3)).toBeNull()
    h.record([snap('BTC', { ts: T - 7200e3 })]); h.record([snap('BTC', { ts: T })])
    expect(h.prior('BTC', T, 3600e3)!.ts).toBe(T - 7200e3)
  })
})

describe('radar', () => {
  const snaps = [snap('BTC', { change24hPct: 1, dayNtlVlm: 9e8 }), snap('HYPE', { change24hPct: 12, fundingHourly: 0.0003, dayNtlVlm: 2e8 }), snap('DUST', { dayNtlVlm: 10 }), snap('ETH', { change24hPct: -6, dayNtlVlm: 5e8 })]
  it('ranks deterministically with explicit reasons; excludes illiquid unless held', () => {
    const r = buildRadar({ snaps, now: T, positions: ['ETH'] })
    expect(r.points.map((p) => p.coin)[0]).toBe('ETH')
    expect(r.points.find((p) => p.coin === 'DUST')).toBeUndefined()
    const hype = r.points.find((p) => p.coin === 'HYPE')!
    expect(hype.reasons.map((x) => x.category).sort()).toEqual(['funding', 'movers', 'volume'])
    expect(hype.warning).toBe(true)
    expect(explainRadar(hype)).toMatch(/Funding 0\.0300%\/h — longs pay shorts/)
    expect(buildRadar({ snaps, now: T, positions: ['ETH'] })).toEqual(r) // deterministic
  })
  it('plot coordinates follow documented scales', () => {
    const r = buildRadar({ snaps, now: T })
    const hype = r.points.find((p) => p.coin === 'HYPE')!
    expect(hype.x).toBe(1) // +12% clipped at 2×5%
    const eth = r.points.find((p) => p.coin === 'ETH')!
    expect(eth.x).toBeCloseTo(-0.6)
    expect(r.points.find((p) => p.coin === 'BTC')!.y).toBeGreaterThan(eth.y)
  })
  it('does not invent OI change without observed history', () => {
    const r = buildRadar({ snaps, now: T })
    expect(r.byCategory['oi-change']).toHaveLength(0)
    const h = new SnapshotHistory(); h.record([snap('BTC', { ts: T - 3700e3, oiNotional: 1e5, dayNtlVlm: 9e8 })])
    const r2 = buildRadar({ snaps: [snap('BTC', { oiNotional: 1.2e5, dayNtlVlm: 9e8 })], history: h, now: T })
    expect(r2.byCategory['oi-change'][0]!.reasons.find((x) => x.category === 'oi-change')!.text).toMatch(/\+20\.0%/)
  })
  it('marks research-only vs verified mapping', () => {
    const r = buildRadar({ snaps, now: T, verifiedPerps: new Set(['BTC']), trendingPerps: [{ coin: 'HYPE', cgId: 'hyperliquid', rank: 0 }] })
    expect(r.points.find((p) => p.coin === 'HYPE')!.mapping).toBe('research-only')
    expect(r.points.find((p) => p.coin === 'BTC')!.mapping).toBe('verified')
  })
})

describe('market DNA', () => {
  it('scores are percentiles with raw/source/method; unavailable stays null', () => {
    const u = [snap('A', { change24hPct: -5 }), snap('B', { change24hPct: 0 }), snap('C', { change24hPct: 5, impactSpreadBps: null })]
    const d = marketDna('C', u, null, T)
    const m = d.axes.find((a) => a.dim === 'momentum')!
    expect(m.score).toBeCloseTo(5 / 6)
    expect(d.axes.find((a) => a.dim === 'volatility')!.score).toBeNull()
    expect(d.axes.find((a) => a.dim === 'liquidity')!.score).toBeNull()
    for (const a of d.axes) { expect(a.source).toBeTruthy(); expect(a.method).toBeTruthy() }
    expect(d.narrative).toMatch(/up 0\.0%|up 5\.0%/)
  })
  it('volatility uses realised hourly vol on fixed scale', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 * (1 + (i % 2 ? 0.01 : -0.01)))
    const d = marketDna('A', [snap('A')], closes, T)
    expect(d.axes.find((a) => a.dim === 'volatility')!.score).toBe(1)
    expect(realizedVol([100, 100, 100], 3600e3)).toBe(0)
  })
  it('percentileRank basics', () => { expect(percentileRank([1, 2, 3, 4], 4)).toBeCloseTo(0.875); expect(percentileRank([], 1)).toBe(0.5) })
})

describe('liquidity lens', () => {
  const book = { coin: 'BTC', time: T - 1500, levels: [[{ px: '99', sz: '1', n: 1 }, { px: '98', sz: '2', n: 1 }], [{ px: '101', sz: '1', n: 1 }, { px: '102', sz: '2', n: 1 }]] } as any
  it('spread, mid, VWAP, slippage vs mid', () => {
    const l = liquidityLens(book, T, [50, 300])
    expect(l.mid).toBe(100); expect(l.spreadBps).toBeCloseTo(200)
    expect(l.ageMs).toBe(1500)
    const e = l.estimates[1]!
    expect(e.sufficient).toBe(true); expect(e.levelsConsumed).toBe(2)
    expect(e.vwap).toBeCloseTo(300 / (1 + 199 / 102))
    expect(e.slippageBps).toBeGreaterThan(100)
  })
  it('insufficient visible liquidity is flagged, never extrapolated', () => {
    const e = estimateFill(book, 'buy', 10_000)
    expect(e.sufficient).toBe(false); expect(e.filledNotional).toBeCloseTo(101 + 204)
  })
  it('empty book', () => {
    const l = liquidityLens({ coin: 'X', time: T, levels: [[], []] } as any, T)
    expect(l.empty).toBe(true); expect(l.mid).toBeNull(); expect(l.estimates[0]!.vwap).toBeNull(); expect(l.estimates[0]!.sufficient).toBe(false)
  })
  it('sell side walks bids', () => { expect(estimateFill(book, 'sell', 50).vwap).toBe(99) })
})

describe('funding clock', () => {
  it('next funding at top of next hour (verified hourly schedule)', () => {
    expect(nextFundingTime(T)).toBe(Date.UTC(2026, 10, 25, 11, 0, 0))
  })
  it('payment formula and direction', () => {
    expect(fundingPayment(2, 100, 0.0001)).toBeCloseTo(0.02) // long pays when positive
    expect(fundingPayment(-2, 100, 0.0001)).toBeCloseTo(-0.02) // short receives
    const c = fundingClock({ coin: 'BTC', rateHourly: 0.0001, oraclePx: 100, now: T, szi: 2 })
    expect(c.direction).toBe('longs-pay-shorts')
    expect(c.horizons.find((h) => h.label === '24h')!.estCostUsd).toBeCloseTo(0.48)
    expect(c.assumption).toMatch(/not guaranteed/)
  })
  it('no position → no fabricated payment; realized from user funding records', () => {
    const c = fundingClock({ coin: 'BTC', rateHourly: -0.0001, oraclePx: 100, now: T, userFundings: [{ time: T - 10, usdc: '-0.5', coin: 'BTC' }, { time: T - 5, usdc: '-0.25', coin: 'ETH' }] })
    expect(c.estNextPaymentUsd).toBeNull(); expect(c.realized!.totalUsd).toBeCloseTo(0.5); expect(c.realized!.count).toBe(1)
  })
})
