import { HL_ENDPOINTS, type HlEnv } from '@strike/shared'

export type WsSub = { type: string; coin?: string; user?: string; interval?: string }
type Listener = (data: unknown) => void
interface WsLike { readyState: number; send(d: string): void; close(): void; onopen: ((e?: unknown) => void) | null; onclose: ((e?: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e?: unknown) => void) | null }
export type WsFactory = (url: string) => WsLike

export function subKey(s: WsSub): string { return JSON.stringify([s.type, s.coin ?? '', (s.user ?? '').toLowerCase(), s.interval ?? '']) }

/** Channel name → subscription key matcher. Hyperliquid echoes data on a channel named after the type (userEvents → "user"). */
function keyForMessage(channel: string, data: any): string[] {
  const t = channel === 'user' ? 'userEvents' : channel
  const coin = data?.coin ?? data?.[0]?.coin ?? data?.s ?? data?.[0]?.s ?? ''
  const user = (data?.user ?? '').toLowerCase()
  const interval = data?.i ?? data?.[0]?.i ?? ''
  return [subKey({ type: t, coin, user, interval }), subKey({ type: t, coin }), subKey({ type: t, user }), subKey({ type: t })]
}

export interface WsStatus { state: 'idle' | 'connecting' | 'open' | 'closed'; reconnects: number; lastMessageAt: number | null; subscriptions: number }

/** One multiplexed connection: N listeners share a single upstream subscription per key (no duplicate public subscriptions). */
export class HlWsMultiplexer {
  private ws: WsLike | null = null
  private listeners = new Map<string, { sub: WsSub; fns: Set<Listener> }>()
  private status: WsStatus = { state: 'idle', reconnects: 0, lastMessageAt: null, subscriptions: 0 }
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private closedByUser = false
  constructor(readonly env: HlEnv, private readonly factory: WsFactory, private readonly opts: { heartbeatMs?: number; reconnectBaseMs?: number; maxReconnectMs?: number } = {}) {}

  getStatus(): WsStatus { return { ...this.status, subscriptions: this.listeners.size } }

  connect() {
    this.closedByUser = false
    this.status.state = 'connecting'
    const ws = this.factory(HL_ENDPOINTS[this.env].ws)
    this.ws = ws
    ws.onopen = () => {
      this.status.state = 'open'
      for (const { sub } of this.listeners.values()) ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }))
      this.heartbeat = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' })) }, this.opts.heartbeatMs ?? 30_000)
    }
    ws.onmessage = (e) => {
      this.status.lastMessageAt = Date.now()
      let msg: any
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (!msg?.channel || msg.channel === 'pong' || msg.channel === 'subscriptionResponse') return
      const seen = new Set<Listener>()
      for (const k of keyForMessage(msg.channel, msg.data)) {
        const entry = this.listeners.get(k)
        if (!entry) continue
        for (const fn of entry.fns) if (!seen.has(fn)) { seen.add(fn); fn(msg.data) }
      }
    }
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.status.state = 'closed'
      if (this.closedByUser) return
      this.status.reconnects++
      const delay = Math.min((this.opts.reconnectBaseMs ?? 500) * 2 ** Math.min(this.status.reconnects, 6), this.opts.maxReconnectMs ?? 30_000)
      setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => { /* onclose handles reconnect */ }
  }

  subscribe(sub: WsSub, fn: Listener): () => void {
    const k = subKey(sub)
    let entry = this.listeners.get(k)
    if (!entry) {
      entry = { sub, fns: new Set() }
      this.listeners.set(k, entry)
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }))
    }
    entry.fns.add(fn)
    return () => {
      const e = this.listeners.get(k)
      if (!e) return
      e.fns.delete(fn)
      if (e.fns.size === 0) {
        this.listeners.delete(k)
        if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ method: 'unsubscribe', subscription: sub }))
      }
    }
  }

  isStale(maxAgeMs: number, now = Date.now()) { return this.status.lastMessageAt == null || now - this.status.lastMessageAt > maxAgeMs }

  close() { this.closedByUser = true; if (this.heartbeat) clearInterval(this.heartbeat); this.ws?.close() }
}
