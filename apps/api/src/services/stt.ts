import type { ApiConfig } from '../config'

export interface SttResult { text: string | null; provider: string; confidence: number | null; latencyMs: number; error: string | null; mode: 'real' | 'disabled' }

/** Configurable STT: any OpenAI-compatible /audio/transcriptions endpoint (e.g. a local faster-whisper server, or a hosted provider).
 * If none is configured we return an explicit error — never a scripted transcript. */
export async function transcribe(cfg: ApiConfig, wav: Uint8Array): Promise<SttResult> {
  const t0 = Date.now()
  if (!cfg.sttUrl) return { text: null, provider: 'none', confidence: null, latencyMs: 0, error: 'STT not configured (set STRIKE_STT_URL). Use typed input.', mode: 'disabled' }
  const form = new FormData()
  form.append('file', new Blob([wav as unknown as ArrayBuffer], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', cfg.sttModel)
  form.append('language', 'en')
  form.append('response_format', 'verbose_json')
  form.append('prompt', 'Hyperliquid trading: BTC, ETH, SOL, HYPE, long, short, leverage, 2x, 3x, liquidation, funding, stop loss, close half.')
  try {
    const res = await fetch(cfg.sttUrl, { method: 'POST', body: form, headers: cfg.sttKey ? { authorization: `Bearer ${cfg.sttKey}` } : {}, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { text: null, provider: new URL(cfg.sttUrl).host, confidence: null, latencyMs: Date.now() - t0, error: `STT HTTP ${res.status}`, mode: 'real' }
    const j: any = await res.json()
    const segs: any[] = j.segments ?? []
    const conf = segs.length ? Math.exp(segs.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / segs.length) : null
    return { text: String(j.text ?? '').trim(), provider: new URL(cfg.sttUrl).host, confidence: conf, latencyMs: Date.now() - t0, error: null, mode: 'real' }
  } catch (e) {
    return { text: null, provider: new URL(cfg.sttUrl).host, confidence: null, latencyMs: Date.now() - t0, error: String((e as Error).message), mode: 'real' }
  }
}

export async function sttHealth(cfg: ApiConfig) {
  if (!cfg.sttUrl) return { configured: false, status: 'disabled' }
  try { const u = new URL(cfg.sttUrl); const r = await fetch(`${u.origin}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null); return { configured: true, host: u.host, status: r?.ok ? 'ok' : 'unknown' } } catch { return { configured: true, status: 'invalid-url' } }
}
