/** Hyperliquid returns HTTP 200 even for rejected orders. Every per-order status must be inspected. */
export type OrderStatusResult =
  | { kind: 'resting'; oid: number; cloid?: string }
  | { kind: 'filled'; oid: number; totalSz: string; avgPx: string; cloid?: string }
  | { kind: 'error'; message: string }
  | { kind: 'success' } // cancels / misc
  | { kind: 'waitingForFill' }
  | { kind: 'waitingForTrigger' }
  | { kind: 'unrecognized'; raw: unknown }

export interface ParsedExchangeResponse {
  ok: boolean
  topLevelError: string | null
  type: string | null
  statuses: OrderStatusResult[]
}

export function parseStatus(s: unknown): OrderStatusResult {
  if (s === 'success') return { kind: 'success' }
  if (s === 'waitingForFill') return { kind: 'waitingForFill' }
  if (s === 'waitingForTrigger') return { kind: 'waitingForTrigger' }
  if (s && typeof s === 'object') {
    const o = s as Record<string, any>
    if (o.resting) return { kind: 'resting', oid: Number(o.resting.oid), cloid: o.resting.cloid }
    if (o.filled) return { kind: 'filled', oid: Number(o.filled.oid), totalSz: String(o.filled.totalSz), avgPx: String(o.filled.avgPx), cloid: o.filled.cloid }
    if (typeof o.error === 'string') return { kind: 'error', message: o.error }
  }
  return { kind: 'unrecognized', raw: s }
}

export function parseExchangeResponse(body: unknown): ParsedExchangeResponse {
  const b = body as Record<string, any> | null
  if (!b || typeof b !== 'object') return { ok: false, topLevelError: 'Empty or non-JSON response', type: null, statuses: [] }
  if (b.status !== 'ok') {
    return { ok: false, topLevelError: typeof b.response === 'string' ? b.response : JSON.stringify(b.response ?? b), type: null, statuses: [] }
  }
  const resp = b.response ?? {}
  const statuses: OrderStatusResult[] = Array.isArray(resp?.data?.statuses) ? resp.data.statuses.map(parseStatus) : []
  const anyError = statuses.some((s) => s.kind === 'error' || s.kind === 'unrecognized')
  return { ok: !anyError, topLevelError: null, type: resp.type ?? null, statuses }
}
