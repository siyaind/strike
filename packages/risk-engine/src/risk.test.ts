import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, evaluateRisk, type RiskInput } from './index'
const base: RiskInput = { coin: 'BTC', reduceOnly: false, orderNotionalUsd: 100, leverage: 3, assetMaxLeverage: 40, positionExposureAfterUsd: 100, totalExposureAfterUsd: 400, accountValueUsd: 1000, marginUsedAfterUsd: 33, availableCollateralUsd: 900, estSlippageBps: 2, openOrders: 0, sessionNotionalUsedUsd: 0, dataTs: 1000, now: 2000, maxDataAgeMs: 10_000 }
const failed = (i: Partial<RiskInput>, p = DEFAULT_POLICY) => evaluateRisk({ ...base, ...i }, p).checks.filter((c) => c.status !== 'pass').map((c) => c.rule)
describe('risk engine', () => {
  it('passes a modest order', () => { expect(evaluateRisk(base).ok).toBe(true) })
  it('notional, leverage (policy and exchange), exposure, concentration', () => {
    expect(failed({ orderNotionalUsd: 5000 })).toContain('max-order-notional')
    expect(failed({ leverage: 10 })).toContain('max-leverage')
    expect(failed({ leverage: 4, assetMaxLeverage: 3 })).toContain('max-leverage')
    expect(failed({ positionExposureAfterUsd: 3000, totalExposureAfterUsd: 3000 })).toContain('position-exposure')
    expect(failed({ positionExposureAfterUsd: 900, totalExposureAfterUsd: 1000 })).toContain('concentration')
  })
  it('stale data fails', () => { expect(failed({ now: 60_000 })).toContain('data-freshness') })
  it('unknown inputs fail closed', () => { const r = evaluateRisk({ ...base, accountValueUsd: null, estSlippageBps: null }); expect(r.ok).toBe(false); expect(r.checks.filter((c) => c.status === 'unknown').length).toBe(2) })
  it('blocked/allowed assets', () => { expect(failed({}, { ...DEFAULT_POLICY, blockedAssets: ['btc'] })).toContain('asset-allowed'); expect(failed({}, { ...DEFAULT_POLICY, allowedAssets: ['ETH'] })).toContain('asset-allowed') })
  it('reduce-only skips exposure-increasing limits but not freshness', () => { const r = evaluateRisk({ ...base, reduceOnly: true, leverage: 99, accountValueUsd: null }); expect(r.ok).toBe(true); expect(failed({ reduceOnly: true, now: 1e9 })).toContain('data-freshness') })
  it('session budget', () => { expect(failed({ sessionNotionalUsedUsd: 2950 })).toContain('session-budget') })
})
