import { describe, expect, it } from 'vitest'
import { positionTimeline, lastTradeWindow, narrate } from './index'
const f = (time: number, side: 'A' | 'B', sz: string, start: string, px = '100') => ({ coin: 'BTC', px, sz, side, time, startPosition: start, dir: side === 'B' ? 'Open Long' : 'Close Long', closedPnl: '0', oid: time, fee: '0.01' })
describe('replay', () => {
  it('classifies entry/add/partial/close and labels reconstruction', () => {
    const t = positionTimeline('BTC', [f(1, 'B', '1', '0'), f(2, 'B', '1', '1'), f(3, 'A', '0.5', '2'), f(4, 'A', '1.5', '1.5'), f(5, 'B', '1', '0')], [{ time: 2.5, delta: { coin: 'BTC', usdc: '-0.1', szi: '2', fundingRate: '0.0001' } }], [{ t: 2.7, coin: 'BTC', ok: true, detail: 'Stop 90 verified' }])
    expect(t.events.map((e) => e.kind)).toEqual(['entry', 'add', 'funding', 'protection-created', 'partial-close', 'close', 'entry'])
    expect(t.events[0]!.provenance).toBe('reconstructed'); expect(t.events[2]!.provenance).toBe('observed')
    expect(t.boundary).toBe(1)
    expect(lastTradeWindow(t.events)).toHaveLength(1)
    expect(narrate(t.events[2]!)).toMatch(/paid 0\.1000 USDC/)
  })
  it('flip detection', () => { expect(positionTimeline('BTC', [f(1, 'A', '2', '1')]).events[0]!.kind).toBe('flip') })
  it('empty', () => { expect(positionTimeline('BTC', []).boundary).toBeNull() })
})
