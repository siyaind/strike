import { waitForEvenAppBridge, TextContainerProperty, ImageContainerProperty, ImageRawDataUpdate, CreateStartUpPageContainer, TextContainerUpgrade, OsEventTypeList, AudioInputSource } from '@evenrealities/even_hub_sdk'
import { ImageQueue, tile, type ImageSlot, type Frame } from '@strike/visual-engine'
import { StrikeApi } from './api'
import { Controller, type Display, type Input, type VoiceCapture } from './controller'
import { mountPhone } from './phone'

const API_BASE: string = (import.meta.env.VITE_STRIKE_API as string | undefined) ?? 'http://localhost:8899'
const log = (...a: unknown[]) => console.log('[strike]', ...a)

// Fixed page layout (one createStartUpPageContainer, then only content updates — no rebuild flicker).
//  y 0..34   header  (firmware text)
//  y 38..182 instrument 576×144 → two 288×144 image containers (SDK max image 288×144)
//  y 186..288 footer (firmware text, 3 lines)
//  full-screen text layer with isEventCapture=1 sits behind everything (image containers cannot capture input).
const C = { evt: { id: 1, name: 'evt' }, hdr: { id: 2, name: 'hdr' }, ftr: { id: 3, name: 'ftr' } }
const SLOTS: ImageSlot[] = [
  { containerID: 4, containerName: 'imgL', x: 0, y: 38, w: 288, h: 144 },
  { containerID: 5, containerName: 'imgR', x: 288, y: 38, w: 288, h: 144 },
]

const bridge = await waitForEvenAppBridge()
log('bridge ready')
const text = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, capture = 0) =>
  new TextContainerProperty({ xPosition: x, yPosition: y, width: w, height: h, borderWidth: 0, borderColor: 0, paddingLength: capture ? 0 : 4, containerID: id, containerName: name, content, isEventCapture: capture })
const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
  containerTotalNum: 5,
  textObject: [text(C.evt.id, C.evt.name, 0, 0, 576, 288, ' ', 1), text(C.hdr.id, C.hdr.name, 0, 0, 576, 34, 'STRIKE'), text(C.ftr.id, C.ftr.name, 0, 186, 576, 102, '')],
  imageObject: SLOTS.map((s) => new ImageContainerProperty({ xPosition: s.x, yPosition: s.y, width: s.w, height: s.h, containerID: s.containerID, containerName: s.containerName })),
}))
log('startup result', created)

// All bridge display calls go through ONE serial chain (image transfers must never overlap).
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>) => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p }
const queue = new ImageQueue((slot, png) => serial(() => bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: slot.containerID, containerName: slot.containerName, imageData: png }))).then((r) => String(r)))
const lastText = new Map<number, string>()
const setText = (c: { id: number; name: string }, content: string) => {
  const v = content.slice(0, 1900)
  if (lastText.get(c.id) === v) return Promise.resolve()
  lastText.set(c.id, v)
  return serial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content: v })))
}
let phone: ReturnType<typeof mountPhone> | null = null
const display: Display = {
  async show(v) {
    await Promise.all([setText(C.hdr, v.header), setText(C.ftr, v.footer)])
    for (const t of tile(v.frame, SLOTS)) void queue.submit(t.slot, t.frame)
    await queue.idle()
    phone?.mirror(v.frame as Frame, v.header, v.footer, queue.metrics)
    log('render', v.header.replace(/\s+/g, ' '), JSON.stringify(queue.metrics))
  },
  async exit() { await bridge.shutDownPageContainer(1) },
}

// Push-to-talk capture from the G2 microphone (16 kHz s16le mono). Only open while LISTENING.
let pcmSink: ((b: Uint8Array) => void) | null = null
const voice: VoiceCapture = {
  async record(maxMs) {
    const chunks: Uint8Array[] = []
    pcmSink = (b) => chunks.push(b)
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false)
    if (!ok) { pcmSink = null; return null }
    await new Promise((r) => setTimeout(r, maxMs))
    await bridge.audioControl(false).catch(() => false)
    pcmSink = null
    const n = chunks.reduce((a, c) => a + c.length, 0); if (n < 3200) return null
    const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length }
    return out
  },
}

const api = new StrikeApi({ base: API_BASE, storage: window.localStorage })
const ctl = new Controller(api, display, { voice })
phone = mountPhone(document.querySelector('#app')!, api, ctl)

const typeOf = (env?: { eventType?: OsEventTypeList }) => (env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null)
let busy = false
const pending: Input[] = []
async function dispatch(i: Input) {
  if (busy) { if (pending.length < 2) pending.push(i); return }
  busy = true
  try { await ctl.input(i) } finally { busy = false }
  const n = pending.shift(); if (n) void dispatch(n)
}
bridge.onEvenHubEvent((e) => {
  if (e.audioEvent) { pcmSink?.(e.audioEvent.audioPcm); return }
  const sys = typeOf(e.sysEvent), txt = typeOf(e.textEvent)
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || txt === OsEventTypeList.DOUBLE_CLICK_EVENT) return void dispatch('double')
  if (txt === OsEventTypeList.SCROLL_TOP_EVENT || sys === OsEventTypeList.SCROLL_TOP_EVENT) return void dispatch('up')
  if (txt === OsEventTypeList.SCROLL_BOTTOM_EVENT || sys === OsEventTypeList.SCROLL_BOTTOM_EVENT) return void dispatch('down')
  if (sys === OsEventTypeList.CLICK_EVENT || txt === OsEventTypeList.CLICK_EVENT) return void dispatch('tap')
  if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) { queue.invalidate(); lastText.clear(); void ctl.render() }
})
await ctl.start()
log('started', API_BASE)
