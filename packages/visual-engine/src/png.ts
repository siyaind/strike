import { zlibSync } from 'fflate'
import type { Frame } from './framebuffer'

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(buf: Uint8Array) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Encode a 4-bit framebuffer as an 8-bit greyscale PNG (level × 17). The SDK converts to 4-bit gray; levels round-trip exactly. */
export function encodePng(f: Frame): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, f.w); dv.setUint32(4, f.h); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = new Uint8Array((f.w + 1) * f.h)
  for (let y = 0; y < f.h; y++) { raw[y * (f.w + 1)] = 0; for (let x = 0; x < f.w; x++) raw[y * (f.w + 1) + 1 + x] = f.px[y * f.w + x]! * 17 }
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Pack to raw 4-bit (2 px / byte, high nibble first) — alternative transfer format, documented in VISUAL-ENGINE.md. */
export function packGray4(f: Frame): Uint8Array {
  const out = new Uint8Array(Math.ceil((f.w * f.h) / 2))
  for (let i = 0; i < f.px.length; i += 2) out[i >> 1] = ((f.px[i]! & 15) << 4) | ((f.px[i + 1] ?? 0) & 15)
  return out
}
