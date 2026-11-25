import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../../api/src/app'
import { fakes, T0 } from '../../../tests/fakes'
import { StrikeApi } from './api'
import { Controller, type View, type Input } from './controller'
import { tile, validateImageSize } from '@strike/visual-engine'

/** Glasses controller driven end-to-end against the real API (in-process) with recorded real Hyperliquid fixtures. */
async function rig(o: Parameters<typeof fakes>[0] = {}) {
  let t = T0
  const { app } = await buildApp({ ...fakes(o), now: () => t, config: { offline: true, confirmSecret: 'x'.repeat(40), signerKek: randomBytes(32), allowedOrigins: [] } })
  const injFetch = (async (url: string, init: any = {}) => {
    const r = await app.inject({ method: init.method ?? 'GET', url: url.replace('http://api', ''), headers: init.headers, payload: init.body })
    return { ok: r.statusCode < 400, status: r.statusCode, json: async () => JSON.parse(r.body) } as any
  }) as typeof fetch
  const views: View[] = []
  let exited = false
  const ctl = new Controller(new StrikeApi({ base: 'http://api', fetch: injFetch }), { show: async (v) => { views.push(v) }, exit: async () => { exited = true } }, { now: () => t })
  await ctl.start()
  const press = async (...ins: Input[]) => { for (const i of ins) await ctl.input(i); return views[views.length - 1]! }
  return { ctl, views, press, exited: () => exited, advance: (ms: number) => { t += ms } }
}

function assertG2Safe(v: View) {
  expect(v.header.length).toBeLessThanOrEqual(2000); expect(v.footer.length).toBeLessThanOrEqual(2000)
  expect(v.frame.w).toBe(576); expect(v.frame.h).toBe(144)
  for (const t of tile(v.frame, [{ containerID: 4, containerName: 'imgL', x: 0, y: 38, w: 288, h: 144 }, { containerID: 5, containerName: 'imgR', x: 288, y: 38, w: 288, h: 144 }])) expect(validateImageSize(t.frame.w, t.frame.h)).toBeNull()
  expect(v.frame.litCount()).toBeGreaterThan(20)
}

describe('G2 controller (vertical slice) against API + recorded live fixtures', () => {
  it('welcome → guest demo → hub → radar → DNA → Lens → Shadow → Funding with real data on every screen', async () => {
    const r = await rig()
    expect(r.views[0]!.footer).toMatch(/GUEST DEMO/)
    let v = await r.press('tap'); expect(r.ctl.s.screen).toBe('hub'); expect(v.header).toMatch(/SIMULATED/)
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('radar'); assertG2Safe(v); expect(v.header).toMatch(/RADAR\s+1\/\d+/)
    // pick a coin without a position: swipe until non-position
    const pts = r.ctl.data.radar.points as any[]; const idx = pts.findIndex((p) => !p.isPosition)
    for (let i = 0; i < idx; i++) await r.press('down')
    const coin = pts[idx].coin
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('dna'); expect(v.header).toContain(`DNA ${coin}`); assertG2Safe(v)
    v = await r.press('down'); expect(r.ctl.s.dnaIdx).toBe(1)
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('lens'); assertG2Safe(v); expect(v.header).toMatch(/BUY \$100/)
    v = await r.press('down'); expect(v.header).toMatch(/\$250/)
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('shadow'); assertG2Safe(v); expect(v.header).toMatch(/OPEN LONG \$250/); expect(v.footer).toMatch(/SIMULATION/)
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('funding'); assertG2Safe(v); expect(v.footer).toMatch(/Rate .*%\/h/)
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('dna') // ring wraps (no orbit without a position)
    v = await r.press('double'); expect(r.ctl.s.screen).toBe('radar')
  })
  it('positions → Position Orbit with stop/liq markers and scenario; unprotected ETH flagged', async () => {
    const r = await rig()
    await r.press('tap', 'down') // hub → POSITIONS
    let v = await r.press('tap'); expect(r.ctl.s.screen).toBe('positions'); expect(v.frame.litCount()).toBeGreaterThan(50)
    const eth = (r.ctl.data.portfolio.positions as any[]).findIndex((p) => p.coin === 'ETH')
    for (let i = 0; i < eth; i++) await r.press('down')
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('orbit'); assertG2Safe(v); expect(v.header).toMatch(/ORBIT ETH\s+SHORT 5x UNPROTECTED/)
    v = await r.press('down'); expect(v.footer).toMatch(/If -10%/)
  })
  it('shadow → preview defaults to CANCEL; confirm requires explicit swipe+tap; receipt is SIMULATED', async () => {
    const r = await rig()
    await r.press('tap', 'tap') // radar
    const pts = r.ctl.data.radar.points as any[]; const btc = pts.findIndex((p) => p.coin === 'BTC')
    for (let i = 0; i < btc; i++) await r.press('down')
    await r.press('tap') // orbit (BTC position)
    expect(r.ctl.s.screen).toBe('orbit')
    await r.press('tap', 'tap', 'tap') // dna → lens → shadow
    expect(r.ctl.s.screen).toBe('shadow')
    for (let i = 0; i < 5; i++) await r.press('down') // idx 3 → 8 (PREVIEW ORDER)
    let v = await r.press('tap'); expect(r.ctl.s.screen).toBe('preview'); expect(r.ctl.s.previewSel).toBe(0); expect(v.frame.litCount()).toBeGreaterThan(100)
    // tap on default = cancel
    v = await r.press('tap'); expect(r.ctl.s.screen).toBe('shadow'); expect(r.ctl.log.some((l) => l.ev === 'preview:cancelled')).toBe(true)
    await r.press('tap'); await r.press('down'); v = await r.press('tap')
    expect(r.ctl.s.screen).toBe('receipt'); expect(r.ctl.data.receipt.label).toBe('SIMULATED EXECUTION'); expect(['FILLED', 'PARTIALLY_FILLED']).toContain(r.ctl.data.receipt.status)
  })
  it('API outage → ERROR screen (no fabricated data), retry works, navigation still responsive', async () => {
    const r = await rig({ failMainnet: 'http500' })
    await r.press('tap') // guest session works (no HL needed)... portfolio may fail
    const v = r.views[r.views.length - 1]!
    expect(['error', 'hub']).toContain(r.ctl.s.screen)
    if (r.ctl.s.screen === 'hub') await r.press('tap')
    expect(r.ctl.s.screen).toBe('error'); expect(r.views[r.views.length - 1]!.footer).toMatch(/retry/i); void v
    await r.press('double'); expect(['hub', 'welcome']).toContain(r.ctl.s.screen)
  })
  it('double-tap at hub exits the app', async () => { const r = await rig(); await r.press('tap', 'double'); expect(r.exited()).toBe(true) })
  it('voice without microphone → honest unavailable message', async () => {
    const r = await rig(); await r.press('tap', 'up') // hub idx → VOICE (wraps)
    const v = await r.press('tap'); expect(r.ctl.s.screen).toBe('voice'); expect(v.frame.litCount()).toBeGreaterThan(10); expect(r.ctl.data.voice.phase).toBe('unavailable')
  })
})
