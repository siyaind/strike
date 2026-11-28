import { HL_ENDPOINTS, type HlEnv } from '@strike/shared'
import type {
  Candle, CandleInterval, ClearinghouseState, FrontendOpenOrder, FundingHistoryRow, L2Book, PerpAssetCtx, PerpAssetMeta, SpotMeta, UserFill, UserFunding,
} from './types'

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

export class HlHttpError extends Error {
  constructor(readonly status: number, readonly body: string, readonly kind: 'http' | 'timeout' | 'network') {
    super(`Hyperliquid ${kind} error ${status}: ${body.slice(0, 200)}`)
  }
}

export interface InfoClientOptions { env: HlEnv; fetch?: FetchLike; timeoutMs?: number; baseUrl?: string }

/** Read-only client for POST /info. Safe on both environments (no signing). */
export class InfoClient {
  readonly env: HlEnv
  readonly url: string
  private readonly f: FetchLike
  private readonly timeoutMs: number
  constructor(opts: InfoClientOptions) {
    this.env = opts.env
    this.url = `${opts.baseUrl ?? HL_ENDPOINTS[opts.env].rest}/info`
    this.f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.timeoutMs = opts.timeoutMs ?? 8000
  }

  /** Read-only info calls are idempotent: on HTTP 429 (shared-IP rate limit) retry ONCE after a short jittered backoff. Exchange calls are never retried. */
  async post<T>(body: Record<string, unknown>): Promise<T> {
    try { return await this.postOnce<T>(body) } catch (e) {
      if (e instanceof HlHttpError && e.status === 429) { await new Promise((r) => setTimeout(r, this.retryDelayMs + Math.floor(Math.random() * this.retryDelayMs))); return this.postOnce<T>(body) }
      throw e
    }
  }
  retryDelayMs = 400

  private async postOnce<T>(body: Record<string, unknown>): Promise<T> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await this.f(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
      if (!res.ok) throw new HlHttpError(res.status, await res.text(), 'http')
      return (await res.json()) as T
    } catch (e) {
      if (e instanceof HlHttpError) throw e
      if ((e as Error)?.name === 'AbortError') throw new HlHttpError(0, 'timeout', 'timeout')
      throw new HlHttpError(0, String((e as Error)?.message ?? e), 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  metaAndAssetCtxs() { return this.post<[{ universe: PerpAssetMeta[] }, PerpAssetCtx[]]>({ type: 'metaAndAssetCtxs' }) }
  meta() { return this.post<{ universe: PerpAssetMeta[] }>({ type: 'meta' }) }
  spotMeta() { return this.post<SpotMeta>({ type: 'spotMeta' }) }
  spotMetaAndAssetCtxs() { return this.post<[SpotMeta, Array<Record<string, string>>]>({ type: 'spotMetaAndAssetCtxs' }) }
  allMids() { return this.post<Record<string, string>>({ type: 'allMids' }) }
  l2Book(coin: string, nSigFigs?: 2 | 3 | 4 | 5) { return this.post<L2Book>(nSigFigs ? { type: 'l2Book', coin, nSigFigs } : { type: 'l2Book', coin }) }
  candleSnapshot(coin: string, interval: CandleInterval, startTime: number, endTime?: number) {
    return this.post<Candle[]>({ type: 'candleSnapshot', req: { coin, interval, startTime, ...(endTime ? { endTime } : {}) } })
  }
  fundingHistory(coin: string, startTime: number, endTime?: number) { return this.post<FundingHistoryRow[]>({ type: 'fundingHistory', coin, startTime, ...(endTime ? { endTime } : {}) }) }
  clearinghouseState(user: string) { return this.post<ClearinghouseState>({ type: 'clearinghouseState', user: user.toLowerCase() }) }
  spotClearinghouseState(user: string) { return this.post<{ balances: Array<{ coin: string; token: number; total: string; hold: string; entryNtl: string }> }>({ type: 'spotClearinghouseState', user: user.toLowerCase() }) }
  frontendOpenOrders(user: string) { return this.post<FrontendOpenOrder[]>({ type: 'frontendOpenOrders', user: user.toLowerCase() }) }
  userFills(user: string) { return this.post<UserFill[]>({ type: 'userFills', user: user.toLowerCase() }) }
  userFunding(user: string, startTime: number, endTime?: number) { return this.post<UserFunding[]>({ type: 'userFunding', user: user.toLowerCase(), startTime, ...(endTime ? { endTime } : {}) }) }
  orderStatus(user: string, oid: number | string) { return this.post<{ status: 'order' | 'unknownOid'; order?: { order: FrontendOpenOrder; status: string; statusTimestamp: number } }>({ type: 'orderStatus', user: user.toLowerCase(), oid }) }
  historicalOrders(user: string) { return this.post<unknown[]>({ type: 'historicalOrders', user: user.toLowerCase() }) }
  userFees(user: string) { return this.post<{ userCrossRate: string; userAddRate: string; userSpotCrossRate?: string; userSpotAddRate?: string }>({ type: 'userFees', user: user.toLowerCase() }) }
  userRole(user: string) { return this.post<{ role: 'missing' | 'user' | 'agent' | 'vault' | 'subAccount'; data?: { user?: string; master?: string } }>({ type: 'userRole', user: user.toLowerCase() }) }
  extraAgents(user: string) { return this.post<Array<{ address: string; name: string; validUntil: number }>>({ type: 'extraAgents', user: user.toLowerCase() }) }
}
