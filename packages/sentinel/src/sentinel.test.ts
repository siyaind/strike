import { describe, expect, it } from 'vitest'
import { evaluateSentinel, SentinelTracker, type SentinelPosition } from './index'
const pos = (o: Partial<SentinelPosition> = {}): SentinelPosition => ({ coin: 'BTC', szi: 0.01, markPx: 100, liquidationPx: 70, unrealizedPnl: 0, marginUsed: 50, fundingHourly: 0.00001, protection: 'PROTECTED', ...o })
const base = { account: '0xabc', now: 10_000, dataTs: 9_000, wsConnected: true, accountValue: 1000, totalMarginUsed: 50 }
describe('sentinel', () => {
  it('spec example: liq 4.2% + stop NOT FOUND → CRITICAL first', () => {
    const ev = evaluateSentinel({ ...base, positions: [pos({ liquidationPx: 95.8, protection: 'UNPROTECTED' })] })
    expect(ev[0]).toMatchObject({ severity: 'CRITICAL', reason: 'BTC LONG: liquidation 4.2% away', action: 'review-position' })
    expect(ev.find((e) => e.key === 'prot:BTC')!.reason).toMatch(/NOT FOUND/)
  })
  it('missing liquidation price → no fabricated liquidation event', () => { expect(evaluateSentinel({ ...base, positions: [pos({ liquidationPx: null })] }).some((e) => e.key.startsWith('liq'))).toBe(false) })
  it('stale data, ws disconnect, margin, external change, unexpected fill', () => {
    const ev = evaluateSentinel({ ...base, now: 200_000, wsConnected: false, totalMarginUsed: 700, positions: [pos({ szi: 0.02 })], prevPositions: [pos()], knownOrderIds: new Set([1]), fillsSinceLast: [{ oid: 9, coin: 'BTC', time: 1 }] })
    expect(ev.map((e) => e.key).sort()).toEqual(['ext:BTC', 'fill:9', 'margin', 'stale', 'ws'].sort())
  })
  it('funding only flagged when the position PAYS', () => {
    expect(evaluateSentinel({ ...base, positions: [pos({ fundingHourly: 0.0005 })] }).some((e) => e.key === 'fund:BTC')).toBe(true)
    expect(evaluateSentinel({ ...base, positions: [pos({ szi: -0.01, liquidationPx: 130, fundingHourly: 0.0005 })] }).some((e) => e.key === 'fund:BTC')).toBe(false)
  })
  it('tracker dedupes and resolves', () => {
    const t = new SentinelTracker()
    t.update(evaluateSentinel({ ...base, positions: [pos({ protection: 'UNPROTECTED' })] }), 1)
    t.update(evaluateSentinel({ ...base, positions: [pos({ protection: 'UNPROTECTED' })] }), 2)
    expect(t.list().filter((e) => e.status === 'current')).toHaveLength(1)
    const after = t.update(evaluateSentinel({ ...base, positions: [pos()] }), 3)
    expect(after[0]!.status).toBe('resolved')
  })
})
