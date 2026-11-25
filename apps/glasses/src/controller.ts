import { Frame, INK, renderDna, renderFunding, renderLens, renderOrbit, renderRadar, renderShadow, shortPx, shortUsd, type RadarDot } from '@strike/visual-engine'
import { ApiError, type StrikeApi } from './api'

/** G2 input vocabulary (Even Hub: swipe up/down on the temple touchpad, tap, double-tap). */
export type Input = 'up' | 'down' | 'tap' | 'double'
export type Screen = 'welcome' | 'hub' | 'radar' | 'positions' | 'orbit' | 'dna' | 'lens' | 'shadow' | 'funding' | 'sentinel' | 'preview' | 'receipt' | 'voice' | 'error'

/** What the controller asks the display to show. Header/footer -> firmware text containers; frame -> 576×144 instrument (tiled to 2 image containers). */
export interface View { header: string; footer: string; frame: Frame }
export interface Display { show(v: View): Promise<void>; exit(): Promise<void> }
export interface VoiceCapture { record(maxMs: number): Promise<Uint8Array | null> }

export const HUB_ITEMS = ['RADAR', 'POSITIONS', 'SENTINEL', 'VOICE'] as const
export const LENS_SIZES = [50, 100, 250, 500, 1000] as const
export const SCENARIOS = [-10, -5, -2, 0, 2, 5, 10] as const
const SHADOW_EXTRA = ['FLIP SIDE', 'PREVIEW ORDER'] as const
const ORBIT_PCTS = [null, -10, -5, -2, 2, 5, 10] as const
const DEFAULT_LEVERAGE = 3

export interface State {
  screen: Screen; stack: Screen[]; coin: string | null
  hubIdx: number; radarIdx: number; posIdx: number; dnaIdx: number; lensSizeIdx: number; shadowIdx: number; shadowSide: 'long' | 'short'; orbitIdx: number; previewSel: 0 | 1; sentIdx: number
  busy: string | null; error: { title: string; detail: string; retry: Screen | null } | null
}
export const initialState = (): State => ({ screen: 'welcome', stack: [], coin: null, hubIdx: 0, radarIdx: 0, posIdx: 0, dnaIdx: 0, lensSizeIdx: 1, shadowIdx: 3, shadowSide: 'long', orbitIdx: 0, previewSel: 0, sentIdx: 0, busy: null, error: null })

const ageLabel = (ms: number | null | undefined) => (ms == null ? 'AGE ?' : ms < 1500 ? 'LIVE' : `${Math.round(ms / 1000)}s OLD`)
const pct = (v: number | null | undefined, d = 1) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const signedUsd = (v: number) => `${v >= 0 ? '+' : '-'}${shortUsd(Math.abs(v))}`

/** Draw a text panel into a 576×144 frame. Selection uses a ► marker + full brightness, never shade alone. */
export function textPanel(lines: Array<{ t: string; sel?: boolean; dim?: boolean; warn?: boolean }>, title?: string, scale: 1 | 2 = 1): Frame {
  const f = new Frame(576, 144)
  let y = 4
  if (title) { f.text(title.toUpperCase().slice(0, 60), 8, y, INK.full); f.hline(8, 568, y + 11, INK.dim); y += 18 }
  const rowH = scale === 2 ? 24 : 13, maxChars = scale === 2 ? 30 : 64
  for (const l of lines) {
    if (y > 144 - rowH + 4) break
    const cy = y + (scale === 2 ? 7 : 3)
    if (l.sel) { f.triangle(12, cy, scale === 2 ? 10 : 6, 'down', INK.full); f.rect(4, y - 3, 568, rowH - 2, INK.dim) }
    if (l.warn) f.warning(30, cy, INK.full)
    f.text(l.t.slice(0, maxChars), l.warn ? 42 : 24, y, l.sel ? INK.full : l.dim ? INK.dim : INK.mid, scale)
    y += rowH
  }
  return f
}
/** Footer = firmware text container: 3 lines of ~52 chars at 576px. Enforce, never overflow. */
export function fitFooter(s: string) { return s.split('\n').slice(0, 3).map((l) => (l.length > 54 ? l.slice(0, 53) + '>' : l)).join('\n') }

export class Controller {
  s: State = initialState()
  data: { radar?: any; dna?: any; lens?: any; funding?: any; portfolio?: any; orbit?: any; shadow?: any; sentinel?: any; preview?: any; receipt?: any; voice?: any } = {}
  readonly log: Array<{ t: number; ev: string }> = []
  constructor(private api: StrikeApi, private display: Display, private opts: { now?: () => number; voice?: VoiceCapture | null } = {}) {}
  private now() { return this.opts.now?.() ?? Date.now() }
  private trace(ev: string) { this.log.push({ t: this.now(), ev }); if (this.log.length > 200) this.log.shift() }

  async start() { await this.render() }

  /** Single entry point for all G2 input. Never throws: failures become an ERROR screen with a retry path. */
  async input(i: Input): Promise<void> {
    this.trace(`input:${i}@${this.s.screen}`)
    try { await this.handle(i) } catch (e) { this.fail(e, this.s.screen) }
    await this.render()
  }

  private fail(e: unknown, retry: Screen | null) {
    const err = e instanceof ApiError ? e : new ApiError(0, 'CLIENT', (e as Error)?.message ?? String(e))
    this.s.busy = null
    this.s.error = { title: err.code, detail: err.message, retry }
    if (this.s.screen !== 'error') { this.s.stack.push(this.s.screen); this.s.screen = 'error' }
    this.trace(`error:${err.code}`)
  }
  private go(screen: Screen) { this.s.stack.push(this.s.screen); this.s.screen = screen }
  private back() { this.s.screen = this.s.stack.pop() ?? 'hub'; if (this.s.screen === 'welcome') this.s.screen = 'hub' }
  private cyc(i: number, n: number, d: number) { return ((i + d) % n + n) % n }

  /** The per-coin instrument ring. Orbit only exists when there is a position. */
  ring(): Screen[] { const has = this.hasPosition(this.s.coin); return [...(has ? (['orbit'] as Screen[]) : []), 'dna', 'lens', 'shadow', 'funding'] }
  hasPosition(c: string | null) { return !!c && !!this.data.portfolio?.positions?.some((p: any) => p.coin === c) }

  private async openCoin(coin: string, first?: Screen) {
    this.s.coin = coin; this.s.dnaIdx = 0; this.s.shadowIdx = 3; this.s.orbitIdx = 0
    const pos = this.data.portfolio?.positions?.find((p: any) => p.coin === coin)
    this.s.shadowSide = pos ? (pos.szi > 0 ? 'long' : 'short') : 'long'
    const target = first ?? this.ring()[0]!
    this.go(target); await this.load(target)
  }
  private async nextInstrument() {
    const r = this.ring(); const i = r.indexOf(this.s.screen); const n = r[(i + 1) % r.length]!
    this.s.screen = n; await this.load(n)
  }

  async load(sc: Screen) {
    const c = this.s.coin
    switch (sc) {
      case 'radar': [this.data.radar, this.data.portfolio] = await Promise.all([this.api.radar(), this.api.portfolio().catch(() => this.data.portfolio)]); break
      case 'positions': this.data.portfolio = await this.api.portfolio(); break
      case 'dna': this.data.dna = await this.api.dna(c!); break
      case 'lens': this.data.lens = await this.api.lens(c!, LENS_SIZES[this.s.lensSizeIdx]!, this.s.shadowSide === 'long' ? 'buy' : 'sell'); break
      case 'funding': this.data.funding = await this.api.funding(c!); break
      case 'orbit': this.data.orbit = await this.api.orbit(c!, ORBIT_PCTS[this.s.orbitIdx] ?? null); break
      case 'shadow': this.data.shadow = await this.api.shadow({ coin: c!, side: this.s.shadowSide, notionalUsd: LENS_SIZES[this.s.lensSizeIdx]!, leverage: DEFAULT_LEVERAGE, action: this.shadowAction() }); break
      case 'sentinel': this.data.sentinel = await this.api.sentinel(); break
      default: break
    }
  }
  private shadowAction() { const pos = this.data.portfolio?.positions?.find((p: any) => p.coin === this.s.coin); if (!pos) return 'open'; return (pos.szi > 0) === (this.s.shadowSide === 'long') ? 'increase' : 'reduce' }

  private async handle(i: Input) {
    const s = this.s
    // Double-tap = back everywhere; at the hub it exits the app (always-available exit).
    if (i === 'double') {
      if (s.screen === 'hub' || s.screen === 'welcome') { this.trace('exit'); await this.display.exit(); return }
      if (s.screen === 'preview') { this.data.preview = null; this.trace('preview:cancelled') }
      this.back()
      if (this.s.screen === 'radar' || this.s.screen === 'positions' || this.s.screen === 'sentinel') await this.load(this.s.screen)
      return
    }
    switch (s.screen) {
      case 'welcome':
        if (i === 'tap') { s.busy = 'STARTING GUEST DEMO'; await this.render(); await this.api.ensureGuest(); this.data.portfolio = await this.api.portfolio(); s.busy = null; s.screen = 'hub'; s.stack = [] }
        return
      case 'hub':
        if (i !== 'tap') { s.hubIdx = this.cyc(s.hubIdx, HUB_ITEMS.length, i === 'down' ? 1 : -1); return }
        { const item = HUB_ITEMS[s.hubIdx]!.toLowerCase() as Screen
          if (item === 'voice') { this.go('voice'); await this.listen(); return }
          this.go(item); await this.load(item) }
        return
      case 'radar': {
        const pts = this.data.radar?.points ?? []
        if (i !== 'tap') { s.radarIdx = this.cyc(s.radarIdx, Math.max(1, pts.length), i === 'down' ? 1 : -1); return }
        const p = pts[s.radarIdx]; if (p) await this.openCoin(p.coin)
        return
      }
      case 'positions': {
        const ps = this.data.portfolio?.positions ?? []
        if (i !== 'tap') { s.posIdx = this.cyc(s.posIdx, Math.max(1, ps.length), i === 'down' ? 1 : -1); return }
        const p = ps[s.posIdx]; if (p) await this.openCoin(p.coin, 'orbit')
        return
      }
      case 'sentinel': {
        const ev = this.data.sentinel?.events ?? []
        if (i !== 'tap') { s.sentIdx = this.cyc(s.sentIdx, Math.max(1, ev.length), i === 'down' ? 1 : -1); return }
        const e = ev[s.sentIdx]; if (e?.coin) await this.openCoin(e.coin, this.hasPosition(e.coin) ? 'orbit' : undefined)
        return
      }
      case 'orbit': if (i === 'tap') return this.nextInstrument(); s.orbitIdx = this.cyc(s.orbitIdx, ORBIT_PCTS.length, i === 'down' ? 1 : -1); return this.load('orbit')
      case 'dna': if (i === 'tap') return this.nextInstrument(); s.dnaIdx = this.cyc(s.dnaIdx, 6, i === 'down' ? 1 : -1); return
      case 'lens': if (i === 'tap') return this.nextInstrument(); s.lensSizeIdx = this.cyc(s.lensSizeIdx, LENS_SIZES.length, i === 'down' ? 1 : -1); return this.load('lens')
      case 'funding': if (i === 'tap') return this.nextInstrument(); return
      case 'shadow': {
        const n = SCENARIOS.length + SHADOW_EXTRA.length
        if (i !== 'tap') { s.shadowIdx = this.cyc(s.shadowIdx, n, i === 'down' ? 1 : -1); return }
        const extra = s.shadowIdx - SCENARIOS.length
        if (extra === 0) { s.shadowSide = s.shadowSide === 'long' ? 'short' : 'long'; return this.load('shadow') }
        if (extra === 1) return this.openPreview()
        return this.nextInstrument()
      }
      case 'preview': {
        if (i !== 'tap') { s.previewSel = s.previewSel === 0 ? 1 : 0; return }
        if (s.previewSel === 0 || !this.data.preview?.proposal?.risk?.ok) { this.data.preview = null; this.trace('preview:cancelled'); this.back(); return }
        s.busy = 'SUBMITTING'; await this.render()
        try { this.data.receipt = await this.api.confirm(this.data.preview.proposal.proposalId, this.data.preview.confirmToken) } finally { s.busy = null }
        this.data.preview = null; s.screen = 'receipt'; this.trace(`receipt:${this.data.receipt?.status}`)
        this.data.portfolio = await this.api.portfolio().catch(() => this.data.portfolio)
        return
      }
      case 'receipt': if (i === 'tap') { s.shadowIdx = 3; s.screen = s.stack.pop() ?? 'hub'; if (s.screen === 'preview') s.screen = s.stack.pop() ?? 'hub'; await this.load(s.screen) } return
      case 'voice': if (i === 'tap') await this.listen(); return
      case 'error': if (i === 'tap' && s.error?.retry) { const r = s.error.retry; s.error = null; s.screen = s.stack.pop() ?? 'hub'; if (r !== 'error') await this.load(r) } return
    }
  }

  private async openPreview() {
    const s = this.s; const action = this.shadowAction()
    const pos = this.data.portfolio?.positions?.find((p: any) => p.coin === s.coin)
    const side = s.shadowSide === 'long' ? 'buy' : 'sell'
    const body: Record<string, unknown> = action === 'reduce' && pos
      ? { coin: s.coin, side, reduceOnly: true, notionalUsd: Math.min(LENS_SIZES[s.lensSizeIdx]!, Math.abs(pos.notionalUsd)), leverage: pos.leverage }
      : { coin: s.coin, side, notionalUsd: LENS_SIZES[s.lensSizeIdx]!, leverage: DEFAULT_LEVERAGE }
    this.data.preview = await this.api.preview(body)
    s.previewSel = 0 // CANCEL is always the default selection
    this.go('preview'); this.trace(`preview:${this.data.preview?.proposal?.proposalId}`)
  }

  private async listen() {
    this.data.voice = { phase: 'listening' }; await this.render()
    const pcm = this.opts.voice ? await this.opts.voice.record(5000) : null
    if (!pcm) { this.data.voice = { phase: 'unavailable', message: 'MICROPHONE NOT AVAILABLE ON THIS DEVICE/SIMULATOR' }; return }
    let b64 = ''; for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000))
    const tr = await this.api.transcribe(btoa(b64))
    if (!tr.text) { this.data.voice = { phase: 'unavailable', message: tr.message ?? 'SPEECH-TO-TEXT NOT CONFIGURED' }; return }
    const r = await this.api.voice(tr.text, { coin: this.s.coin, screen: this.s.stack[this.s.stack.length - 1] ?? 'hub' })
    this.data.voice = { phase: 'review', transcript: tr.text, intent: r.intent, note: r.note }
  }

  // ───────────────────────── views ─────────────────────────
  view(): View {
    const s = this.s, d = this.data
    const sim = d.portfolio?.env === 'simulated' || d.preview?.label?.startsWith('SIM') ? ' SIM' : ''
    const hdr = (t: string, extra = '') => `STRIKE  ${t}${extra ? '  ' + extra : ''}${sim ? '  [SIMULATED]' : ''}`
    if (s.busy) return { header: hdr('...'), footer: `${s.busy}...\nPlease wait.`, frame: textPanel([{ t: s.busy + '...' }], 'WORKING') }
    switch (s.screen) {
      case 'welcome': return { header: 'STRIKE G2  | Hyperliquid instruments', footer: 'Tap: start GUEST DEMO (simulated account, live public data)\nPair a real account from the companion app.\nDouble-tap: exit', frame: welcomeFrame() }
      case 'hub': return { header: hdr('HOME'), footer: 'Swipe: choose  |  Tap: open  |  Double-tap: exit', frame: textPanel(HUB_ITEMS.map((t, i) => ({ t: `${t}${t === 'SENTINEL' && d.sentinel?.events?.length ? `  (${d.sentinel.events.length})` : ''}`, sel: i === s.hubIdx })), undefined, 2) }
      case 'radar': {
        const pts: any[] = d.radar?.points ?? []
        const sel = pts[s.radarIdx]
        const dots: RadarDot[] = pts.slice(0, 24).map((p, i) => ({ coin: p.coin, x: p.x, y: p.y, size: p.size, isPosition: p.isPosition, isWatch: p.isWatch, warning: p.warning, selected: i === s.radarIdx }))
        if (sel && s.radarIdx >= 24) dots.push({ coin: sel.coin, x: sel.x, y: sel.y, size: sel.size, isPosition: sel.isPosition, isWatch: sel.isWatch, warning: sel.warning, selected: true })
        return { header: hdr('RADAR', `${s.radarIdx + 1}/${pts.length} ${ageLabel(d.radar ? this.now() - d.radar.marketTs : null)}`), footer: sel ? `${sel.coin} ${shortPx(sel.markPx ?? 0)} ${pct(sel.change24hPct)}  score ${Math.round(sel.score)}\n${String(sel.explanation ?? '').replace(/^[^:]*:\s*/, '').split(';')[0]}\nTap: open | X=24h Y=vol | *pos o watch !fund` : 'No markets', frame: renderRadar(dots) }
      }
      case 'positions': {
        const ps: any[] = d.portfolio?.positions ?? []
        return { header: hdr('POSITIONS', `${ps.length}`), footer: `Value ${shortUsd(d.portfolio?.accountValue ?? 0)} | margin ${shortUsd(d.portfolio?.totalMarginUsed ?? 0)}\n! = no verified stop\nSwipe: choose | Tap: Position Orbit | Double: back`, frame: textPanel(ps.map((p, i) => ({ t: `${p.coin.padEnd(6)} ${p.side.toUpperCase().padEnd(5)} ${String(p.leverage + 'x').padEnd(4)} ${shortUsd(Math.abs(p.notionalUsd)).padStart(7)}  PNL ${signedUsd(p.unrealizedPnl ?? 0)}  ${p.protection?.state ?? '?'}`, sel: i === s.posIdx, warn: p.protection?.state !== 'PROTECTED' })), 'OPEN POSITIONS') }
      }
      case 'orbit': {
        const o = d.orbit; const p = o?.position
        if (!p) return { header: hdr('ORBIT'), footer: 'No position', frame: textPanel([{ t: 'NO POSITION' }]) }
        const sc = o.scenario
        const liq = p.liquidationPx ? `LIQ ${shortPx(p.liquidationPx)} (${p.liquidationSource === 'exchange' ? 'exchange' : 'approx'})` : 'LIQ unavailable'
        return { header: hdr(`ORBIT ${p.coin}`, `${p.side.toUpperCase()} ${p.leverage}x ${p.protection.state}`), footer: `${liq} | PNL ${signedUsd(p.unrealizedPnl ?? 0)}\n${sc ? `If ${pct(sc.pct, 0)} -> ${shortPx(sc.px)}: ${signedUsd(sc.pnlChangeUsd)} (hypothetical)` : 'Swipe: scenario move'}\nTap: next instrument | Double: back`, frame: renderOrbit({ coin: p.coin, side: p.side, leverage: p.leverage, entryPx: p.entryPx, markPx: p.markPx, liquidationPx: p.liquidationPx, stopPx: p.protection?.stop?.triggerPx ?? null, takeProfitPx: p.protection?.takeProfit?.triggerPx ?? null, scenarioPx: sc?.px ?? null }) }
      }
      case 'dna': {
        const axes: any[] = d.dna?.axes ?? []
        const a = axes[s.dnaIdx]
        return { header: hdr(`DNA ${s.coin}`, 'vs HL universe'), footer: a ? `${a.label}: ${a.raw}${a.score == null ? ' (unavailable)' : ` | pctile ${Math.round(a.score * 100)}`}\n${String(a.explanation).slice(0, 110)}\nSwipe: axis | Tap: Liquidity Lens` : 'Loading', frame: renderDna(axes.map((x) => ({ label: x.label, score: x.score, raw: x.raw })), s.dnaIdx) }
      }
      case 'lens': {
        const l = d.lens; const size = LENS_SIZES[s.lensSizeIdx]!
        const est = l?.estimates?.find((e: any) => e.notionalUsd === size)
        return { header: hdr(`LENS ${s.coin}`, `${s.shadowSide === 'long' ? 'BUY' : 'SELL'} $${size} ${ageLabel(l?.ageMs)}`), footer: l?.empty ? 'Order book empty - no estimate.' : `Spread ${l?.spreadBps?.toFixed(1) ?? '-'}bp | est slip ${est?.slippageBps?.toFixed(1) ?? '-'}bp${est && !est.sufficient ? ' | NOT ENOUGH VISIBLE DEPTH' : ''}\nVisible book only; fills are not guaranteed.\nSwipe: size | Tap: Shadow Trade`, frame: renderLens({ bids: l?.bids ?? [], asks: l?.asks ?? [], orderNotional: size, side: s.shadowSide === 'long' ? 'buy' : 'sell', sufficient: est?.sufficient ?? false, slippageBps: est?.slippageBps ?? null }) }
      }
      case 'shadow': {
        const r = d.shadow; const n = SCENARIOS.length
        const extra = s.shadowIdx >= n ? SHADOW_EXTRA[s.shadowIdx - n] : null
        const sc = r?.scenarios ?? []
        const frame = r ? renderShadow({ nowExposure: Math.abs(r.exposureNowUsd), afterExposure: Math.abs(r.exposureAfterUsd), scaleMax: Math.max(Math.abs(r.exposureNowUsd), Math.abs(r.exposureAfterUsd), 1) * 1.2, scenarios: sc.map((x: any) => ({ pct: x.pct, pnl: x.pnlChangeUsd })), selected: extra ? -1 : s.shadowIdx, riskBudgetPct: r.riskBudgetPct ?? null }) : textPanel([{ t: 'LOADING' }])
        const sel = !extra ? sc[s.shadowIdx] : null
        return { header: hdr(`SHADOW ${s.coin}`, `${r?.action?.toUpperCase() ?? ''} ${s.shadowSide.toUpperCase()} $${LENS_SIZES[s.lensSizeIdx]} ${DEFAULT_LEVERAGE}x`), footer: r ? `Entry~${r.estEntryPx ? shortPx(r.estEntryPx) : '-'} fee~$${r.estFeeUsd.toFixed(2)} margin~${shortUsd(r.initialMarginUsd)} fund ${signedUsd(-r.fundingPerHourUsd)}/h\n${sel ? `If ${pct(sel.pct, 0)}: ${signedUsd(sel.pnlChangeUsd)} - SIMULATION, not a forecast` : extra === 'FLIP SIDE' ? '> Tap: flip to ' + (s.shadowSide === 'long' ? 'SHORT' : 'LONG') : '> Tap: PREVIEW ORDER (you confirm separately)'}\nSwipe: scenario / FLIP / PREVIEW | Tap: select` : 'Loading', frame }
      }
      case 'funding': {
        const f = d.funding
        return { header: hdr(`FUNDING ${s.coin}`, f ? f.direction.replace(/-/g, ' ').toUpperCase() : ''), footer: f ? `Rate ${(f.rateHourly * 100).toFixed(4)}%/h | next in ${Math.round(f.msToNext / 60000)}m${f.estNextPaymentUsd != null ? ` | you ${f.estNextPaymentUsd > 0 ? 'pay' : 'receive'} ~$${Math.abs(f.estNextPaymentUsd).toFixed(2)}` : ''}\n${f.assumption ?? ''}`.slice(0, 220) + '\nTap: next instrument | Double: back' : 'Loading', frame: f ? renderFunding({ msToNext: f.msToNext, intervalMs: f.intervalMs, rateHourly: f.rateHourly, history: (f.history ?? []).map((h: any) => h.rate) }) : textPanel([]) }
      }
      case 'sentinel': {
        const ev: any[] = d.sentinel?.events ?? []
        return { header: hdr('SENTINEL', `${ev.length} event(s)`), footer: `${ev[s.sentIdx]?.reason ?? 'No current alerts.'}\nSentinel only alerts while STRIKE is open. It never trades.\nTap: open market | Double: back`, frame: textPanel(ev.length ? ev.map((e, i) => ({ t: `${e.severity.padEnd(8)} ${String(e.reason).slice(0, 52)}`, sel: i === s.sentIdx, warn: e.severity !== 'INFO' })) : [{ t: 'ALL CLEAR - NO CURRENT EVENTS', dim: true }], 'SENTINEL') }
      }
      case 'preview': {
        const pv = d.preview; const p = pv?.proposal
        const ok = !!p?.risk?.ok
        const failed = (p?.risk?.checks ?? []).filter((c: any) => c.status !== 'pass')
        const lines = [
          { t: `${pv?.label ?? ''}` },
          { t: `${p?.wire?.isBuy ? 'BUY' : 'SELL'} ${p?.wire?.sz} ${p?.instrument?.coin}  IOC  ${p?.wire?.reduceOnly ? 'REDUCE-ONLY' : ''}` },
          { t: `${p?.priceConstraint ?? ''}` },
          { t: `NOTIONAL ${shortUsd(p?.notionalUsd ?? 0)}  LEV ${p?.leverage}x` },
          ...(failed.length ? failed.slice(0, 2).map((c: any) => ({ t: `RISK ${c.status.toUpperCase()}: ${c.rule} ${c.value}/${c.limit}`, warn: true })) : [{ t: 'RISK CHECKS: ALL PASS' }]),
          { t: '' },
          { t: 'CANCEL', sel: s.previewSel === 0 },
          { t: ok ? 'CONFIRM' : 'CONFIRM (BLOCKED BY RISK)', sel: s.previewSel === 1, dim: !ok },
        ]
        return { header: hdr('PREVIEW', `expires ${p ? Math.max(0, Math.round((p.expiresAt - this.now()) / 1000)) : 0}s`), footer: 'Review every line. Voice can never confirm.\nSwipe: CANCEL / CONFIRM | Tap: select\nDouble-tap: cancel', frame: textPanel(lines, 'ORDER PREVIEW') }
      }
      case 'receipt': {
        const r = d.receipt
        return { header: hdr('RECEIPT', r?.label ?? ''), footer: `${r?.id ?? ''}\n${r?.env === 'testnet' ? `oid ${r?.oid ?? '-'} | reconcile from exchange` : 'Simulated fill against the live public book.'}\nTap: back`, frame: textPanel([{ t: `STATUS ${r?.status}` }, { t: `${r?.side?.toUpperCase()} ${r?.filledSz ?? 0}/${r?.requestedSz} ${r?.coin}` }, { t: `AVG PX ${r?.avgPx ?? '-'}` }, { t: r?.error ? `ERROR ${r.error}` : '' }], 'RECEIPT') }
      }
      case 'voice': {
        const v = d.voice ?? { phase: 'idle' }
        const body = v.phase === 'listening' ? [{ t: 'LISTENING... (5s max)' }] : v.phase === 'review' ? [{ t: `HEARD: "${v.transcript}"` }, { t: `INTENT: ${v.intent?.type}${v.intent?.coin ? ' ' + v.intent.coin : ''}` }, { t: v.note ?? '' }] : [{ t: v.message ?? 'TAP TO TALK', warn: v.phase === 'unavailable' }]
        return { header: hdr('VOICE'), footer: 'Tap: talk | Double: back\nVoice can navigate and prepare previews only.', frame: textPanel(body, 'VOICE') }
      }
      case 'error': return { header: hdr('ERROR'), footer: `${s.error?.detail ?? ''}\nTap: retry | Double-tap: back`, frame: textPanel([{ t: s.error?.title ?? 'ERROR', warn: true }, { t: (s.error?.detail ?? '').slice(0, 60) }, { t: 'NO DATA SHOWN WHILE UNAVAILABLE', dim: true }], 'UNAVAILABLE') }
    }
  }
  async render() { const v = this.view(); await this.display.show({ ...v, footer: fitFooter(v.footer) }) }
}

function welcomeFrame() {
  const f = new Frame(576, 144)
  f.text('STRIKE', 288 - f.textWidth('STRIKE', 4) / 2, 18, INK.full, 4)
  f.textCenter('HYPERLIQUID INSTRUMENTS FOR EVEN G2', 288, 64, INK.mid)
  f.hline(120, 456, 80, INK.dim)
  f.triangle(150, 104, 8, 'down', INK.full)
  f.text('TAP: GUEST DEMO  (SIMULATED)', 164, 100, INK.full)
  f.textCenter('LIVE PUBLIC DATA . NO REAL FUNDS', 288, 122, INK.dim)
  return f
}
