/** G2 audio: PCM 16 kHz, signed 16-bit little-endian, mono; 100 ms (3200 bytes) per event (Even Hub docs). */
export const SAMPLE_RATE = 16000
export const BYTES_PER_100MS = 3200

export interface RecorderConfig { maxMs: number; silenceMs: number; silenceRms: number; minSpeechMs: number }
export const DEFAULT_RECORDER: RecorderConfig = { maxMs: 8000, silenceMs: 900, silenceRms: 450, minSpeechMs: 300 }

export function rms16(buf: Uint8Array): number {
  const n = Math.floor(buf.length / 2)
  if (!n) return 0
  const dv = new DataView(buf.buffer, buf.byteOffset, n * 2)
  let s = 0
  for (let i = 0; i < n; i++) { const v = dv.getInt16(i * 2, true); s += v * v }
  return Math.sqrt(s / n)
}

/** Accumulates PCM chunks with max-duration and trailing-silence end-pointing. */
export class PcmRecorder {
  private chunks: Uint8Array[] = []
  private bytes = 0
  private speechMs = 0
  private silentMs = 0
  done: null | 'silence' | 'max' | 'manual' = null
  constructor(private readonly cfg: RecorderConfig = DEFAULT_RECORDER) {}
  push(chunk: Uint8Array): this['done'] {
    if (this.done) return this.done
    this.chunks.push(chunk); this.bytes += chunk.length
    const ms = (chunk.length / 2 / SAMPLE_RATE) * 1000
    if (rms16(chunk) >= this.cfg.silenceRms) { this.speechMs += ms; this.silentMs = 0 } else this.silentMs += ms
    if (this.durationMs() >= this.cfg.maxMs) this.done = 'max'
    else if (this.speechMs >= this.cfg.minSpeechMs && this.silentMs >= this.cfg.silenceMs) this.done = 'silence'
    return this.done
  }
  stop() { if (!this.done) this.done = 'manual' }
  durationMs() { return (this.bytes / 2 / SAMPLE_RATE) * 1000 }
  hadSpeech() { return this.speechMs >= this.cfg.minSpeechMs }
  pcm(): Uint8Array { const out = new Uint8Array(this.bytes); let o = 0; for (const c of this.chunks) { out.set(c, o); o += c.length } return out }
}

/** Peak-normalise to ~-3 dBFS (helps quiet glasses-mic captures). */
export function normalize(pcm: Uint8Array): Uint8Array {
  const n = Math.floor(pcm.length / 2), dv = new DataView(pcm.buffer, pcm.byteOffset, n * 2)
  let peak = 1
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(dv.getInt16(i * 2, true)))
  const g = Math.min(8, 23170 / peak)
  const out = new Uint8Array(n * 2), ov = new DataView(out.buffer)
  for (let i = 0; i < n; i++) ov.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(dv.getInt16(i * 2, true) * g))), true)
  return out
}

/** Wrap PCM16 mono in a WAV container for STT providers. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length), dv = new DataView(out.buffer)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length, true)
  out.set(pcm, 44); return out
}
