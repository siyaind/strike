/** Thin client for the STRIKE API. All network access from the glasses app goes through the STRIKE backend (CORS + secrets stay server-side). */
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message) } }

export interface StrikeApiOpts { base: string; fetch?: typeof fetch; timeoutMs?: number; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null }
export class StrikeApi {
  token: string | null
  private f: typeof fetch
  constructor(private o: StrikeApiOpts) { this.f = o.fetch ?? fetch.bind(globalThis); this.token = o.storage?.getItem('strike.token') ?? null }
  setToken(t: string | null) { this.token = t; if (t) this.o.storage?.setItem('strike.token', t); else this.o.storage?.removeItem('strike.token') }
  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 10_000)
    try {
      const r = await this.f(this.o.base + path, { method, signal: ctl.signal, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new ApiError(r.status, j?.error ?? 'HTTP_' + r.status, j?.message ?? `HTTP ${r.status}`)
      return j as T
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(0, (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', (e as Error).name === 'AbortError' ? 'STRIKE API timed out' : 'STRIKE API unreachable')
    } finally { clearTimeout(timer) }
  }
  async ensureGuest() {
    if (this.token) { try { await this.req('GET', '/v1/me'); return } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; this.setToken(null) } }
    const s = await this.req<{ token: string }>('POST', '/v1/guest/session'); this.setToken(s.token)
  }
  async pair(code: string) { const s = await this.req<{ token: string }>('POST', '/v1/pairing/claim', { code, deviceName: 'Even G2' }); this.setToken(s.token) }
  radar = () => this.req<any>('GET', '/v1/radar')
  dna = (c: string) => this.req<any>('GET', `/v1/market-dna/${encodeURIComponent(c)}`)
  lens = (c: string, size: number, side: 'buy' | 'sell') => this.req<any>('GET', `/v1/liquidity-lens/${encodeURIComponent(c)}?size=${size}&side=${side}`)
  funding = (c: string) => this.req<any>('GET', `/v1/funding/${encodeURIComponent(c)}`)
  portfolio = () => this.req<any>('GET', '/v1/portfolio')
  orbit = (c: string, pct: number | null) => this.req<any>('GET', `/v1/positions/${encodeURIComponent(c)}/orbit${pct == null ? '' : `?scenarioPct=${pct}`}`)
  shadow = (b: { coin: string; side: 'long' | 'short'; notionalUsd: number; leverage: number; action?: string }) => this.req<any>('POST', '/v1/shadow-trade', b)
  sentinel = () => this.req<any>('GET', '/v1/sentinel/events')
  preview = (b: Record<string, unknown>) => this.req<any>('POST', '/v1/trade/preview', b)
  confirm = (proposalId: string, confirmToken: string) => this.req<any>('POST', '/v1/trade/confirm', { proposalId, confirmToken })
  voice = (text: string, context: { coin: string | null; screen: string }, source = 'stt', confidence: number | null = null) => this.req<any>('POST', '/v1/voice/command', { text, context, source, confidence })
  transcribe = (pcmBase64: string) => this.req<any>('POST', '/v1/voice/transcribe', { pcmBase64 })
}
