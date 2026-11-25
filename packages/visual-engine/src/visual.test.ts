import { describe, expect, it, vi } from 'vitest'
import { unzlibSync } from 'fflate'
import { Frame, INK, validateImageSize, G2_IMG_MAX_W, G2_IMG_MAX_H } from './framebuffer'
import { encodePng, packGray4 } from './png'
import { orbitLayout } from './orbit'
import { renderChart, renderDna, renderFunding, renderLens, renderOrbit, renderRadar, renderShadow, INSTRUMENT_W, INSTRUMENT_H } from './instruments'
import { ImageQueue, tile } from './pipeline'

function decodePng(b: Uint8Array) {
  expect([...b.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const dv = new DataView(b.buffer, b.byteOffset)
  const w = dv.getUint32(16), h = dv.getUint32(20)
  let o = 8, idat: Uint8Array[] = []
  while (o < b.length) { const len = dv.getUint32(o); const type = String.fromCharCode(...b.slice(o + 4, o + 8)); if (type === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len)); o += 12 + len }
  const raw = unzlibSync(idat[0]!)
  return { w, h, bitDepth: b[24], colorType: b[25], raw }
}

describe('framebuffer + PNG', () => {
  it('PNG round-trips 4-bit levels exactly (×17)', () => {
    const f = new Frame(20, 20); f.set(3, 4, 15); f.set(5, 6, 8)
    const d = decodePng(encodePng(f))
    expect(d).toMatchObject({ w: 20, h: 20, bitDepth: 8, colorType: 0 })
    expect(d.raw[4 * 21 + 1 + 3]).toBe(255); expect(d.raw[6 * 21 + 1 + 5]).toBe(136)
  })
  it('gray4 packing', () => { const f = new Frame(2, 1); f.set(0, 0, 15); f.set(1, 0, 1); expect([...packGray4(f)]).toEqual([0xf1]) })
  it('all pixels quantised to 0..15', () => { const f = new Frame(4, 4); f.set(0, 0, 99); f.set(1, 1, -5); expect(Math.max(...f.px)).toBe(15); expect(f.get(1, 1)).toBe(0) })
  it('image size validation matches SDK limits', () => {
    expect(validateImageSize(288, 144)).toBeNull()
    expect(validateImageSize(289, 144)).toMatch(/exceeds/)
    expect(validateImageSize(288, 145)).toMatch(/exceeds/)
    expect(validateImageSize(19, 100)).toMatch(/below/)
  })
  it('hash is stable and content-sensitive', () => { const a = new Frame(10, 10), b = new Frame(10, 10); expect(a.hash()).toBe(b.hash()); b.set(1, 1, 1); expect(a.hash()).not.toBe(b.hash()) })
})

describe('position orbit geometry', () => {
  const long = { coin: 'BTC', side: 'long' as const, leverage: 3, entryPx: 100, markPx: 105, liquidationPx: 70, stopPx: 95, takeProfitPx: 120 }
  it('markers are ordered by price left→right and scaled linearly', () => {
    const l = orbitLayout(long)
    expect(l.mode).toBe('linear')
    expect(l.markers.map((m) => m.kind)).toEqual(['liq', 'stop', 'entry', 'mark', 'tp'])
    const x = (k: string) => l.markers.find((m) => m.kind === k)!.x
    // Linear: equal price gaps → equal pixel gaps (±1px rounding)
    expect(Math.abs((x('entry') - x('stop')) - (x('mark') - x('entry')))).toBeLessThanOrEqual(1)
    expect(l.liqDistancePct).toBeCloseTo((35 / 105) * 100); expect(l.liqDirection).toBe('below')
  })
  it('short: liq ABOVE, prices still increase left→right (no label flipping)', () => {
    const l = orbitLayout({ coin: 'ETH', side: 'short', leverage: 5, entryPx: 100, markPx: 98, liquidationPx: 118, stopPx: 104, takeProfitPx: 90 })
    expect(l.markers.map((m) => m.kind)).toEqual(['tp', 'mark', 'entry', 'stop', 'liq'])
    expect(l.liqDirection).toBe('above'); expect(l.warnings).not.toContain('Liquidation price is on the unexpected side of mark — verify exchange data.')
  })
  it('missing liquidation → explicit N/A, no marker', () => {
    const l = orbitLayout({ ...long, liquidationPx: null })
    expect(l.missing).toContain('liq'); expect(l.liqDistancePct).toBeNull(); expect(l.markers.some((m) => m.kind === 'liq')).toBe(false)
    const f = renderOrbit({ ...long, liquidationPx: null }, l)
    expect(f.ascii().length).toBeGreaterThan(0)
  })
  it('extreme liquidation → focused scale with clipping flag (never hidden nonlinear)', () => {
    const l = orbitLayout({ ...long, liquidationPx: 1, takeProfitPx: null, stopPx: 99, markPx: 101 })
    expect(l.mode).toBe('focused')
    const liq = l.markers.find((m) => m.kind === 'liq')!
    expect(liq.clipped).toBe('left'); expect(liq.x).toBe(l.x0)
    const x = (k: string) => l.markers.find((m) => m.kind === k)!.x
    expect(Math.abs((x('entry') - x('stop')) - (x('mark') - x('entry')))).toBeLessThanOrEqual(1) // core still linear
  })
  it('overlapping markers alternate label rows', () => {
    const l = orbitLayout({ ...long, markPx: 100.01, liquidationPx: 50, takeProfitPx: 150 })
    const e = l.markers.find((m) => m.kind === 'entry')!, n = l.markers.find((m) => m.kind === 'mark')!
    expect(Math.abs(e.x - n.x)).toBeLessThan(44); expect(e.labelRow).not.toBe(n.labelRow)
  })
  it('stop already through price is flagged', () => { expect(orbitLayout({ ...long, stopPx: 110 }).warnings.join()).toMatch(/through/) })
  it('scenario marker added at hypothetical price', () => {
    const l = orbitLayout({ ...long, scenarioPx: 105 * 0.95 })
    expect(l.markers.find((m) => m.kind === 'scenario')!.px).toBeCloseTo(99.75)
  })
  it('extremely narrow price differences do not divide by zero', () => {
    const l = orbitLayout({ coin: 'X', side: 'long', leverage: 1, entryPx: 1, markPx: 1, liquidationPx: null, stopPx: null, takeProfitPx: null })
    expect(l.markers.every((m) => Number.isFinite(m.x))).toBe(true)
  })
})

describe('instruments render inside SDK limits', () => {
  const all: Array<[string, Frame]> = [
    ['radar', renderRadar([{ coin: 'BTC', x: 0.1, y: 0.9, size: 1, isPosition: true, isWatch: false, warning: false, selected: true }, { coin: 'HYPE', x: 1, y: 0.7, size: 0.5, isPosition: false, isWatch: true, warning: true }, { coin: 'ETH', x: -0.6, y: 0.8, size: 0.9, isPosition: false, isWatch: false, warning: false }])],
    ['dna', renderDna([{ label: 'Momentum', score: 0.8, raw: '+2.1%' }, { label: 'Volatility', score: null, raw: 'unavailable' }])],
    ['lens', renderLens({ bids: [{ cumNotional: 100, distBps: 1 }], asks: [{ cumNotional: 100, distBps: 1 }], orderNotional: 1000, side: 'buy', sufficient: false, slippageBps: null })],
    ['lens-empty', renderLens({ bids: [], asks: [], orderNotional: 100, side: 'buy', sufficient: false, slippageBps: null })],
    ['orbit', renderOrbit({ coin: 'BTC', side: 'long', leverage: 3, entryPx: 100, markPx: 105, liquidationPx: 70, stopPx: 95, takeProfitPx: 120 })],
    ['shadow', renderShadow({ nowExposure: 300, afterExposure: 800, scaleMax: 1000, scenarios: [-10, -5, -2, 0, 2, 5, 10].map((p) => ({ pct: p, pnl: p * 8 })), selected: 1, riskBudgetPct: 64 })],
    ['funding', renderFunding({ msToNext: 18 * 60e3, intervalMs: 3600e3, rateHourly: 0.0001, history: [0.0001, -0.00005, 0.00002] })],
    ['chart', renderChart([{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5 }, { t: 2, o: 1.5, h: 1.6, l: 1, c: 1.1 }], [{ t: 1, kind: 'buy' }])],
    ['chart-empty', renderChart([])],
  ]
  for (const [name, f] of all) it(`${name}: ${INSTRUMENT_W}x${INSTRUMENT_H}, splits into two valid 288x144 tiles, has content`, () => {
    expect([f.w, f.h]).toEqual([576, 144])
    expect(f.litCount()).toBeGreaterThan(20)
    const tiles = tile(f, [{ containerID: 3, containerName: 'imgL', x: 0, y: 36, w: 288, h: 144 }, { containerID: 4, containerName: 'imgR', x: 288, y: 36, w: 288, h: 144 }])
    for (const t of tiles) { expect(t.frame.w).toBeLessThanOrEqual(G2_IMG_MAX_W); expect(t.frame.h).toBeLessThanOrEqual(G2_IMG_MAX_H) }
  })
  it('radar: point positions follow data (x = change, y = volume pct)', () => {
    const f = renderRadar([{ coin: 'A', x: -1, y: 0, size: 0, isPosition: true, isWatch: false, warning: false }])
    expect(f.get(40, 128)).toBe(INK.full) // bottom-left point centre
  })
  it('lens with insufficient liquidity draws a warning marker', () => {
    const a = renderLens({ bids: [], asks: [{ cumNotional: 50, distBps: 2 }], orderNotional: 1000, side: 'buy', sufficient: true, slippageBps: 1 })
    const b = renderLens({ bids: [], asks: [{ cumNotional: 50, distBps: 2 }], orderNotional: 1000, side: 'buy', sufficient: false, slippageBps: 1 })
    expect(b.litCount()).toBeGreaterThan(a.litCount())
  })
  it('tile rejects oversize containers', () => { expect(() => tile(new Frame(576, 144), [{ containerID: 1, containerName: 'x', x: 0, y: 0, w: 300, h: 144 }])).toThrow(/exceeds/) })
})

describe('image queue', () => {
  it('is serial, suppresses duplicates, and records failures without retry', async () => {
    let inFlight = 0, maxInFlight = 0
    const send = vi.fn(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return 'success' })
    const q = new ImageQueue(send)
    const slot = { containerID: 3, containerName: 'imgL', x: 0, y: 0, w: 288, h: 144 }
    const f = new Frame(288, 144); f.set(1, 1, 15)
    await Promise.all([q.submit(slot, f), q.submit({ ...slot, containerID: 4 }, f), q.submit(slot, f)])
    await q.idle()
    expect(maxInFlight).toBe(1)
    await q.submit(slot, f) // identical → suppressed
    expect(send).toHaveBeenCalledTimes(2); expect(q.metrics.suppressed).toBeGreaterThanOrEqual(1)
    const bad = new ImageQueue(async () => 'imageSizeInvalid')
    await bad.submit(slot, f)
    expect(bad.metrics.failures).toBe(1); expect(bad.metrics.lastError).toBe('imageSizeInvalid')
    const thrower = new ImageQueue(async () => { throw new Error('sendFailed') })
    await thrower.submit(slot, f); expect(thrower.metrics.failures).toBe(1)
  })
})
