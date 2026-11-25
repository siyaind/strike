import { Frame, INK } from './framebuffer'
import { orbitLayout, type OrbitInput, type OrbitLayout } from './orbit'

export const INSTRUMENT_W = 576
export const INSTRUMENT_H = 144

const f2 = (n: number, dp = 2) => (Number.isFinite(n) ? n.toFixed(dp) : '?')
export function shortPx(v: number): string {
  if (!Number.isFinite(v)) return '?'
  const a = Math.abs(v)
  if (a >= 100000) return `${(v / 1000).toFixed(1)}K`
  if (a >= 1000) return v.toFixed(0)
  if (a >= 1) return v.toPrecision(5).replace(/\.?0+$/, '')
  return v.toPrecision(4)
}
export function shortUsd(v: number): string {
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(2)}`
}

// ───────────────────────── RADAR ─────────────────────────
export interface RadarDot { coin: string; x: number; y: number; size: number; isPosition: boolean; isWatch: boolean; warning: boolean; selected?: boolean }
/** x ∈ [-1,1] = 24h change (documented clip), y ∈ [0,1] = volume percentile. Shapes, not shades, carry meaning. */
export function renderRadar(dots: RadarDot[], opts: { title?: string } = {}): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const L = 40, R = 560, T = 10, B = 128
  f.hline(L, R, B, INK.grid); f.vline((L + R) / 2, T, B, INK.grid, [2, 3])
  f.text('-', L - 10, B - 4, INK.dim); f.text('+', R + 4, B - 4, INK.dim)
  f.text('VOL', 2, T, INK.dim); f.text('24H', R - 22, B + 6, INK.dim)
  for (let i = 1; i <= 3; i++) f.hline(L, R, B - (i * (B - T)) / 4, INK.grid, [1, 5])
  const placed: Array<{ x: number; y: number }> = []
  const sorted = [...dots].sort((a, b) => Number(!!a.selected) - Number(!!b.selected))
  for (const d of sorted) {
    const x = Math.round(L + ((d.x + 1) / 2) * (R - L))
    const y = Math.round(B - d.y * (B - T))
    const r = 2 + Math.round(d.size * 4)
    if (d.warning) f.warning(x, y)
    else if (d.isPosition) f.circle(x, y, r, INK.full, true)
    else if (d.isWatch) f.circle(x, y, r, INK.full, false)
    else f.diamond(x, y, Math.max(2, r - 1), INK.mid, false)
    if (d.selected) { f.rect(x - r - 4, y - r - 4, 2 * r + 9, 2 * r + 9, INK.full) }
    // Label unless it would collide with an earlier label (keep most relevant: input order = rank).
    const lx = x + r + 3, ly = y - 4
    if (!placed.some((p) => Math.abs(p.x - lx) < d.coin.length * 8 + 4 && Math.abs(p.y - ly) < 9) || d.selected) {
      f.text(d.coin.slice(0, 6), Math.min(lx, R - d.coin.length * 8), ly, d.selected ? INK.full : INK.mid)
      placed.push({ x: lx, y: ly })
    }
  }
  if (opts.title) f.text(opts.title, L + 4, T, INK.dim)
  return f
}

// ───────────────────────── MARKET DNA ─────────────────────────
export interface DnaRow { label: string; score: number | null; raw: string }
export function renderDna(rows: DnaRow[], selected = -1): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const rowH = 22, barX = 112, barW = 200, segs = 10
  rows.slice(0, 6).forEach((r, i) => {
    const y = 4 + i * rowH
    if (i === selected) f.triangle(4, y + 4, 6, 'down', INK.full)
    f.text(r.label.toUpperCase().slice(0, 12), 14, y, i === selected ? INK.full : INK.mid)
    f.rect(barX, y - 2, barW, 12, INK.dim)
    if (r.score == null) { f.question(barX + barW / 2, y + 4); }
    else {
      const filled = Math.round(r.score * segs)
      for (let s = 0; s < segs; s++) { const sx = barX + 2 + s * ((barW - 4) / segs); if (s < filled) f.fillRect(sx, y + 1, (barW - 4) / segs - 2, 6, INK.full) }
      f.vline(barX + barW / 2, y - 4, y + 11, INK.grid, [1, 1]) // median tick (50th percentile)
    }
    f.text(r.raw.slice(0, 30), barX + barW + 10, y, INK.mid)
  })
  return f
}

// ───────────────────────── LIQUIDITY LENS ─────────────────────────
export interface LensView { bids: Array<{ cumNotional: number; distBps: number }>; asks: Array<{ cumNotional: number; distBps: number }>; orderNotional: number; side: 'buy' | 'sell'; sufficient: boolean; slippageBps: number | null; maxBps?: number }
/** Mirrored cumulative depth. X = distance from mid in bp (same scale both sides), bar height = cumulative notional (shared linear scale). */
export function renderLens(v: LensView): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const mid = 288, half = 260, T = 14, B = 124, maxBps = v.maxBps ?? 50
  const maxN = Math.max(1, ...v.bids.filter((p) => p.distBps <= maxBps).map((p) => p.cumNotional), ...v.asks.filter((p) => p.distBps <= maxBps).map((p) => p.cumNotional), v.orderNotional)
  const yOf = (n: number) => B - (n / maxN) * (B - T)
  f.hline(mid - half, mid + half, B, INK.grid)
  f.vline(mid, T - 6, B + 4, INK.full)
  f.text('BIDS', 8, 2, INK.mid); f.textRight('ASKS', 568, 2, INK.mid); f.textCenter('MID', mid, B + 8, INK.dim)
  f.text(`-${maxBps}BP`, 8, B + 8, INK.dim); f.textRight(`+${maxBps}BP`, 568, B + 8, INK.dim)
  const draw = (pts: LensView['bids'], dir: -1 | 1, ink: number) => {
    let prevX = mid, prevN = 0
    for (const p of pts) {
      if (p.distBps > maxBps) break
      const x = Math.round(mid + dir * (p.distBps / maxBps) * half)
      // step: hold previous cumulative until this level, then rise
      for (let xx = Math.min(prevX, x); xx <= Math.max(prevX, x); xx += 2) f.vline(xx, yOf(prevN), B, ink)
      prevX = x; prevN = p.cumNotional
    }
    const end = Math.round(mid + dir * half)
    for (let xx = Math.min(prevX, end); xx <= Math.max(prevX, end); xx += 2) f.vline(xx, yOf(prevN), B, ink)
  }
  draw(v.bids, -1, INK.dim); draw(v.asks, 1, INK.mid)
  // Order-size line on the side being consumed (buy consumes asks)
  const y = Math.round(yOf(v.orderNotional))
  if (v.side === 'buy') f.hline(mid + 2, mid + half, y, INK.full, [6, 3]); else f.hline(mid - half, mid - 2, y, INK.full, [6, 3])
  if (!v.sufficient) { f.warning(v.side === 'buy' ? mid + half - 8 : mid - half + 8, y - 10) }
  return f
}

// ───────────────────────── POSITION ORBIT ─────────────────────────
export function renderOrbit(p: OrbitInput, layout: OrbitLayout = orbitLayout(p)): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const railY = 74
  f.hline(layout.x0, layout.x1, railY, INK.mid)
  f.text(layout.mode === 'focused' ? 'FOCUSED SCALE' : 'LINEAR SCALE', layout.x0, 134, INK.grid)
  f.triangle(560, 8, 8, p.side === 'long' ? 'up' : 'down', INK.full)
  for (const m of layout.markers) {
    const x = m.x
    const above = m.labelRow === 0
    const ly = above ? railY - 34 : railY + 22
    const lab = { liq: 'LIQ', stop: 'STOP', entry: 'ENTRY', mark: 'NOW', tp: 'TP', scenario: 'SCEN' }[m.kind]
    switch (m.kind) {
      case 'liq': f.warning(x, railY - 1); break
      case 'stop': f.vline(x, railY - 16, railY + 16, INK.full, [3, 2]); break
      case 'entry': f.circle(x, railY, 5, INK.full, false); break
      case 'mark': f.diamond(x, railY, 6, INK.full, true); break
      case 'tp': f.rect(x - 5, railY - 5, 11, 11, INK.full); f.vline(x, railY - 12, railY + 12, INK.full); break
      case 'scenario': f.vline(x, railY - 20, railY + 20, INK.mid, [1, 2]); f.triangle(x, railY - 22, 6, 'down', INK.mid, false); break
    }
    if (m.clipped) f.text(m.clipped === 'left' ? '<' : '>', m.clipped === 'left' ? x - 14 : x + 8, railY - 4, INK.full)
    const t1 = lab, t2 = shortPx(m.px)
    const w = Math.max(f.textWidth(t1), f.textWidth(t2))
    const lx = Math.max(0, Math.min(576 - w, x - w / 2))
    f.text(t1, lx, ly, m.kind === 'scenario' ? INK.mid : INK.full)
    f.text(t2, lx, ly + 10, INK.mid)
  }
  for (const k of layout.missing) if (k === 'liq') f.text('LIQ: N/A', 8, 4, INK.full)
  return f
}

// ───────────────────────── SHADOW TRADE ─────────────────────────
export interface ShadowViewModel { nowExposure: number; afterExposure: number; scaleMax: number; scenarios: Array<{ pct: number; pnl: number }>; selected: number; riskBudgetPct: number | null }
export function renderShadow(v: ShadowViewModel): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const bx = 70, bw = 200
  const w = (n: number) => Math.round(Math.min(1, Math.abs(n) / Math.max(1, v.scaleMax)) * bw)
  f.text('NOW', 8, 10, INK.mid); f.rect(bx, 6, bw, 14, INK.dim); f.fillRect(bx + 2, 9, Math.max(0, w(v.nowExposure) - 4), 8, INK.dim)
  f.text('AFTER', 8, 34, INK.full); f.rect(bx, 30, bw, 14, INK.full); f.fillRect(bx + 2, 33, Math.max(0, w(v.afterExposure) - 4), 8, INK.full)
  f.text(shortUsd(v.nowExposure), bx + bw + 8, 10, INK.mid); f.text(shortUsd(v.afterExposure), bx + bw + 8, 34, INK.full)
  if (v.riskBudgetPct != null) { f.text('RISK BUDGET', 8, 58, INK.mid); f.rect(bx + 40, 56, 160, 10, INK.dim); f.fillRect(bx + 42, 58, Math.round(Math.min(1, v.riskBudgetPct / 100) * 156), 6, INK.full); f.text(`${Math.round(v.riskBudgetPct)}%`, bx + 208, 58, INK.full) }
  // Scenario strip: discrete hypothetical moves; bar up = gain, down = loss (position + label, never shade alone)
  const sx = 330, sw = 236, base = 104
  const maxAbs = Math.max(1, ...v.scenarios.map((s) => Math.abs(s.pnl)))
  f.hline(sx, sx + sw, base, INK.grid)
  const step = sw / v.scenarios.length
  v.scenarios.forEach((s, i) => {
    const cx = Math.round(sx + step * i + step / 2)
    const h = Math.round((Math.abs(s.pnl) / maxAbs) * 34)
    if (s.pnl >= 0) f.fillRect(cx - 6, base - h, 12, h, i === v.selected ? INK.full : INK.dim)
    else f.rect(cx - 6, base, 12, Math.max(1, h), i === v.selected ? INK.full : INK.dim)
    f.textCenter(`${s.pct > 0 ? '+' : ''}${s.pct}`, cx, base + (s.pnl >= 0 ? 6 : h + 4), i === v.selected ? INK.full : INK.grid)
    if (i === v.selected) f.triangle(cx, 56, 6, 'down', INK.full)
  })
  f.text('SCENARIO %', sx, 4, INK.dim)
  const sel = v.scenarios[v.selected]
  if (sel) f.text(`${sel.pnl >= 0 ? '+' : ''}${shortUsd(sel.pnl)}`, sx + 100, 4, INK.full)
  f.text('SIMULATION - NOT A FORECAST', 8, 132, INK.grid)
  return f
}

// ───────────────────────── FUNDING CLOCK ─────────────────────────
export interface FundingViewModel { msToNext: number | null; intervalMs: number; rateHourly: number; history: number[] }
export function renderFunding(v: FundingViewModel): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const cx = 72, cy = 72, r = 58
  f.circle(cx, cy, r, INK.mid)
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; f.line(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6), cx + Math.cos(a) * r, cy + Math.sin(a) * r, INK.dim) }
  if (v.msToNext != null) {
    const elapsed = 1 - v.msToNext / v.intervalMs
    const a = elapsed * Math.PI * 2 - Math.PI / 2
    f.line(cx, cy, cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10), INK.full)
    f.circle(cx, cy, 3, INK.full, true)
    f.diamond(cx, cy - r, 4, INK.full, true) // settlement marker at top of the hour
  } else f.question(cx, cy)
  // Funding history bars: above axis = longs paid, below = shorts paid
  const hx = 160, hw = 400, mid = 72
  f.hline(hx, hx + hw, mid, INK.grid)
  f.text('FUNDING HISTORY (1H)', hx, 4, INK.dim)
  const n = v.history.length
  const maxAbs = Math.max(1e-9, ...v.history.map(Math.abs))
  v.history.forEach((rt, i) => {
    const x = Math.round(hx + (i / Math.max(1, n)) * hw)
    const h = Math.round((Math.abs(rt) / maxAbs) * 50)
    if (rt >= 0) f.vline(x, mid - h, mid, INK.mid); else f.vline(x, mid, mid + h, INK.mid, [2, 1])
  })
  f.text('LONGS PAY', hx, 18, INK.grid); f.text('SHORTS PAY', hx, 128, INK.grid)
  return f
}

// ───────────────────────── PRICE CHART (Replay / Momentum) ─────────────────────────
export interface ChartCandle { t: number; o: number; h: number; l: number; c: number }
export interface ChartEvent { t: number; kind: 'buy' | 'sell' | 'protect' | 'funding' | 'close'; selected?: boolean }
export function renderChart(candles: ChartCandle[], events: ChartEvent[] = [], opts: { style?: 'line' | 'candles'; selectedIndex?: number } = {}): Frame {
  const f = new Frame(INSTRUMENT_W, INSTRUMENT_H)
  const L = 4, R = 520, T = 6, B = 136
  if (!candles.length) { f.question(288, 72); f.textCenter('NO DATA', 288, 90); return f }
  const hi = Math.max(...candles.map((c) => c.h)), lo = Math.min(...candles.map((c) => c.l))
  const span = Math.max(hi - lo, hi * 1e-6)
  const yOf = (p: number) => B - ((p - lo) / span) * (B - T)
  const xOf = (i: number) => L + (candles.length === 1 ? (R - L) / 2 : (i / (candles.length - 1)) * (R - L))
  const style = opts.style ?? (candles.length <= 60 ? 'candles' : 'line')
  candles.forEach((c, i) => {
    const x = Math.round(xOf(i))
    if (style === 'candles') {
      f.vline(x, yOf(c.h), yOf(c.l), INK.dim)
      const top = Math.min(yOf(c.o), yOf(c.c)), bot = Math.max(yOf(c.o), yOf(c.c))
      const bw = Math.max(1, Math.floor((R - L) / candles.length / 2) - 1)
      if (c.c >= c.o) f.rect(x - bw, top, 2 * bw + 1, Math.max(1, bot - top + 1), INK.full) // up: hollow
      else f.fillRect(x - bw, top, 2 * bw + 1, Math.max(1, bot - top + 1), INK.mid) // down: filled
    } else if (i > 0) f.line(xOf(i - 1), yOf(candles[i - 1]!.c), x, yOf(c.c), INK.full)
  })
  const hiI = candles.findIndex((c) => c.h === hi), loI = candles.findIndex((c) => c.l === lo)
  f.triangle(Math.round(xOf(hiI)), Math.round(yOf(hi)) - 6, 5, 'down', INK.full); f.triangle(Math.round(xOf(loI)), Math.round(yOf(lo)) + 6, 5, 'up', INK.full)
  f.text(shortPx(hi), R + 4, T, INK.mid); f.text(shortPx(lo), R + 4, B - 8, INK.mid)
  const t0 = candles[0]!.t, t1 = candles[candles.length - 1]!.t
  for (const e of events) {
    if (e.t < t0 || e.t > t1) continue
    const x = Math.round(L + ((e.t - t0) / Math.max(1, t1 - t0)) * (R - L))
    if (e.kind === 'buy') f.triangle(x, B - 4, 6, 'up', INK.full)
    else if (e.kind === 'sell' || e.kind === 'close') f.triangle(x, T + 4, 6, 'down', INK.full)
    else if (e.kind === 'protect') f.vline(x, T, B, INK.mid, [3, 2])
    else f.set(x, B, INK.full)
    if (e.selected) f.rect(x - 5, T, 11, B - T, INK.full)
  }
  if (opts.selectedIndex != null && candles[opts.selectedIndex]) { const x = Math.round(xOf(opts.selectedIndex)); f.vline(x, T, B, INK.full, [1, 1]) }
  return f
}

export { f2 }
