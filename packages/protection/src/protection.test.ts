import { describe, expect, it } from 'vitest'
import { deriveProtection, protectiveOrderParams, validateStopPlacement, type ExchangeOpenOrder } from './index'
const stop = (o: Partial<ExchangeOpenOrder> = {}): ExchangeOpenOrder => ({ coin: 'BTC', oid: 1, side: 'A', sz: '0.01', isTrigger: true, triggerPx: '90000', reduceOnly: true, orderType: 'Stop Market', ...o })
describe('protection state', () => {
  it('PROTECTED only when exchange lists a covering reduce-only stop', () => { expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [stop()] }).state).toBe('PROTECTED') })
  it('UNPROTECTED with no stop', () => { expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [] }).state).toBe('UNPROTECTED') })
  it('PARTIALLY_PROTECTED', () => { const s = deriveProtection({ coin: 'BTC', positionSzi: 0.02, openOrders: [stop()] }); expect(s.state).toBe('PARTIALLY_PROTECTED'); expect(s.coveredPct).toBe(50) })
  it('wrong-side trigger does not protect', () => { const s = deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [stop({ side: 'B' })] }); expect(s.state).toBe('UNPROTECTED'); expect(s.orphans).toEqual([1]) })
  it('duplicates flagged', () => { expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [stop(), stop({ oid: 2 })] }).duplicates).toEqual([2]) })
  it('orphans after position closed', () => { const s = deriveProtection({ coin: 'BTC', positionSzi: 0, openOrders: [stop()] }); expect(s.state).toBe('NO_PROTECTION'); expect(s.orphans).toEqual([1]) })
  it('UNKNOWN when exchange state unavailable', () => { expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: null }).state).toBe('UNKNOWN') })
  it('PENDING and FAILED', () => {
    expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [], pending: true }).state).toBe('PROTECTION_PENDING')
    expect(deriveProtection({ coin: 'BTC', positionSzi: 0.01, openOrders: [], lastSubmitFailed: true }).state).toBe('PROTECTION_FAILED')
  })
  it('positionTpsl with sz 0 covers whole position', () => { expect(deriveProtection({ coin: 'BTC', positionSzi: 0.05, openOrders: [stop({ sz: '0', isPositionTpsl: true })] }).state).toBe('PROTECTED') })
  it('order params: long → reduce-only sell with bounded limit below trigger', () => {
    const p = protectiveOrderParams({ positionSzi: 0.01, triggerPx: 90000, kind: 'sl', slippageBps: 100 })
    expect(p).toMatchObject({ isBuy: false, sz: 0.01, reduceOnly: true }); expect(p.limitPx).toBeCloseTo(89100)
  })
  it('stop placement validation', () => { expect(validateStopPlacement('long', 100, 101)).toMatch(/below/); expect(validateStopPlacement('short', 100, 99)).toMatch(/above/); expect(validateStopPlacement('long', 100, 95)).toBeNull() })
})
