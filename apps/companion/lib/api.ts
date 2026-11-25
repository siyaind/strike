'use client'
export const API_BASE = process.env.NEXT_PUBLIC_STRIKE_API ?? 'http://localhost:8899'
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, msg: string) { super(msg) } }
const KEY = 'strike.companion.token'
export const getToken = () => (typeof window === 'undefined' ? null : window.localStorage.getItem(KEY))
export const setToken = (t: string | null) => { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) }

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const tok = init.auth === false ? null : getToken()
  let r: Response
  try {
    r = await fetch(API_BASE + path, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  } catch { throw new ApiError(0, 'NETWORK', `STRIKE API unreachable at ${API_BASE}`) }
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new ApiError(r.status, j?.error ?? `HTTP_${r.status}`, j?.message ?? `HTTP ${r.status}`)
  return j as T
}

export async function ensureSession(): Promise<{ mode: string }> {
  if (getToken()) { try { return await api('/v1/me') } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; setToken(null) } }
  const s = await api<{ token: string; mode: string }>('/v1/guest/session', { method: 'POST', auth: false })
  setToken(s.token); return s
}
