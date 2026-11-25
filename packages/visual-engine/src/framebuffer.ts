import { GLYPHS, GLYPH_H, GLYPH_W } from './font'

/** G2 image limits (SDK 0.0.12+ docs: ImageContainerProperty width 20–288, height 20–144; 4-bit greyscale). */
export const G2_IMG_MAX_W = 288
export const G2_IMG_MAX_H = 144
export const G2_IMG_MIN = 20
export const G2_SCREEN_W = 576
export const G2_SCREEN_H = 288

/** Brightness levels (0 = off/transparent on optical see-through display, 15 = full). Meaning NEVER depends on level alone. */
export const INK = { off: 0, grid: 4, dim: 8, mid: 11, full: 15 } as const

/** Deterministic 4-bit greyscale framebuffer. One byte per pixel (0..15). */
export class Frame {
  readonly px: Uint8Array
  constructor(readonly w: number, readonly h: number) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`Invalid frame ${w}x${h}`)
    this.px = new Uint8Array(w * h)
  }
  set(x: number, y: number, v: number) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const q = Math.max(0, Math.min(15, Math.round(v)))
    if (q > this.px[y * this.w + x]!) this.px[y * this.w + x] = q
  }
  get(x: number, y: number) { return this.px[y * this.w + x] ?? 0 }
  clear() { this.px.fill(0) }
  litCount(minLevel = 1) { let n = 0; for (const p of this.px) if (p >= minLevel) n++; return n }

  line(x0: number, y0: number, x1: number, y1: number, v: number = INK.full, dash: [number, number] | null = null) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let err = dx + dy, i = 0
    for (;;) {
      if (!dash || i % (dash[0] + dash[1]) < dash[0]) this.set(x0, y0, v)
      i++
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }
  hline(x0: number, x1: number, y: number, v: number = INK.full, dash: [number, number] | null = null) { this.line(x0, y, x1, y, v, dash) }
  vline(x: number, y0: number, y1: number, v: number = INK.full, dash: [number, number] | null = null) { this.line(x, y0, x, y1, v, dash) }
  rect(x: number, y: number, w: number, h: number, v: number = INK.full) { this.hline(x, x + w - 1, y, v); this.hline(x, x + w - 1, y + h - 1, v); this.vline(x, y, y + h - 1, v); this.vline(x + w - 1, y, y + h - 1, v) }
  fillRect(x: number, y: number, w: number, h: number, v: number = INK.full) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v) }
  circle(cx: number, cy: number, r: number, v: number = INK.full, fill = false) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (fill ? d <= r + 0.3 : Math.abs(d - r) < 0.6) this.set(cx + x, cy + y, v)
    }
  }
  /** Filled/outlined triangle pointing up or down. */
  triangle(cx: number, cy: number, s: number, dir: 'up' | 'down', v: number = INK.full, fill = true) {
    for (let j = 0; j <= s; j++) {
      const half = Math.round((j * s) / (2 * s) + j / 2)
      const y = dir === 'up' ? cy - Math.floor(s / 2) + j : cy + Math.floor(s / 2) - j
      if (fill || j === s) this.hline(cx - half, cx + half, y, v)
      else { this.set(cx - half, y, v); this.set(cx + half, y, v) }
    }
  }
  diamond(cx: number, cy: number, r: number, v: number = INK.full, fill = true) {
    for (let y = -r; y <= r; y++) {
      const w = r - Math.abs(y)
      if (fill) this.hline(cx - w, cx + w, cy + y, v); else { this.set(cx - w, cy + y, v); this.set(cx + w, cy + y, v) }
    }
  }
  /** Warning marker: outlined triangle with "!" — liquidation and alerts. */
  warning(cx: number, cy: number, v: number = INK.full) {
    this.triangle(cx, cy, 10, 'up', v, false)
    this.vline(cx, cy - 2, cy + 1, v); this.set(cx, cy + 3, v)
  }
  /** Question marker for unknown values. */
  question(cx: number, cy: number, v: number = INK.full) { this.circle(cx, cy, 6, v); this.text('?', cx - 3, cy - 3, v, 1, true) }

  textWidth(s: string, scale = 1) { return s.length * GLYPH_W * scale - (s.length ? scale : 0) }
  /** Draw text with the embedded bitmap font. Returns width drawn. Unknown glyphs render as '?'. */
  text(s: string, x: number, y: number, v: number = INK.full, scale = 1, narrow = false): number {
    const adv = (narrow ? GLYPH_W - 1 : GLYPH_W) * scale
    let cx = Math.round(x)
    for (const ch of s) {
      const g = GLYPHS[ch] ?? GLYPHS['?']!
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = g[r]!
        for (let c = 0; c < GLYPH_W; c++) if (bits & (1 << (7 - c))) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + c * scale + sx, Math.round(y) + r * scale + sy, v)
      }
      cx += adv
    }
    return cx - Math.round(x)
  }
  textRight(s: string, xRight: number, y: number, v: number = INK.full, scale = 1) { return this.text(s, xRight - this.textWidth(s, scale), y, v, scale) }
  textCenter(s: string, xc: number, y: number, v: number = INK.full, scale = 1) { return this.text(s, xc - this.textWidth(s, scale) / 2, y, v, scale) }

  /** Crop a sub-rectangle (used to split a 576-wide instrument into two 288-wide SDK images). */
  crop(x: number, y: number, w: number, h: number): Frame {
    const f = new Frame(w, h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) f.px[j * w + i] = this.get(x + i, y + j)
    return f
  }
  /** Stable content hash (FNV-1a) for duplicate-image suppression. */
  hash(): string {
    let h = 0x811c9dc5
    for (let i = 0; i < this.px.length; i++) { h ^= this.px[i]!; h = Math.imul(h, 0x01000193) >>> 0 }
    return `${this.w}x${this.h}:${h.toString(16)}`
  }
  /** ASCII dump for golden tests. */
  ascii(): string {
    const chars = ' .:-=+*#%@@@@@@@'
    let out = ''
    for (let y = 0; y < this.h; y++) { for (let x = 0; x < this.w; x++) out += chars[this.get(x, y)]; out += '\n' }
    return out
  }
}

export function validateImageSize(w: number, h: number): string | null {
  if (w < G2_IMG_MIN || h < G2_IMG_MIN) return `image ${w}x${h} below minimum ${G2_IMG_MIN}`
  if (w > G2_IMG_MAX_W || h > G2_IMG_MAX_H) return `image ${w}x${h} exceeds ${G2_IMG_MAX_W}x${G2_IMG_MAX_H}`
  return null
}
