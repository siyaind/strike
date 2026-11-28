import { describe, expect, it } from 'vitest'
import { shadowTrade, type ShadowInput } from './index'
const book = { coin: 'ETH', time: 1000, levels: [[{ px: '2999', sz: '10', n: 1 }], [{ px: '3001', sz: '10', n: 1 }]] } as any
const base: ShadowInput = { coin: 'ETH', side: 'long', action: 'open', notionalUsd: 500, leverage: 3, markPx: 3000, oraclePx: 3000, fundingHourly: 0.0001, szDecimals: 4, book, now: 2000, existing: { szi: 0.1, entryPx: 2900 }, otherExposureUsd: 0, accountValueUsd: 1000, riskBudgetUsd: 260 }
describe('shadow trade', () => {
  it('spec example: $500 ETH long at 3x on top of $300 exposure', () => {
    const r = shadowTrade(base)
    expect(r.exposureNowUsd).toBeCloseTo(300)
    expect(r.qty).toBeCloseTo(0.1666, 4); expect(r.estEntryPx).toBe(3001)
    expect(r.exposureAfterUsd).toBeCloseTo((0.1 + 0.1666) * 3000, 2)
    expect(r.initialMarginUsd).toBeCloseTo(r.exposureAfterUsd / 3)
    expect(r.fundingPerHourUsd).toBeGreaterThan(0)
    expect(r.liquidationAfter).toBeNull()
    expect(r.scenarios.find((s) => s.pct === -5)!.pnlChangeUsd).toBeCloseTo(-r.exposureAfterUsd * 0.05)
  })
  it('quantity rounds DOWN to szDecimals', () => { const r = shadowTrade({ ...base, szDecimals: 2 }); expect(r.qty).toBe(0.16) })
  it('reduce never reverses the position', () => { const r = shadowTrade({ ...base, action: 'reduce', notionalUsd: 10_000 }); expect(r.qty).toBeCloseTo(0.1); expect(r.sziAfter).toBeCloseTo(0) })
  it('short side: negative szi, gains on down moves', () => {
    const r = shadowTrade({ ...base, side: 'short', existing: null })
    expect(r.sziAfter).toBeLessThan(0); expect(r.scenarios.find((s) => s.pct === -10)!.pnlChangeUsd).toBeGreaterThan(0)
    expect(r.estEntryPx).toBe(2999)
  })
  it('no book → entry unavailable, still a pure simulation', () => { const r = shadowTrade({ ...base, book: null }); expect(r.entrySource).toBe('unavailable'); expect(r.visibleLiquiditySufficient).toBe(false) })
})
