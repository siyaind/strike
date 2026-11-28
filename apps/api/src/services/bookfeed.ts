import type { HlWsMultiplexer, L2Book } from '@strike/hyperliquid'

/**
 * Live L2 books over the Hyperliquid WebSocket. Subscriptions are opened on first use and shared by all users,
 * then dropped after `idleMs` without readers. This keeps REST weight near zero for books (shared-IP hosts such as
 * Render's free tier get HTTP 429 on REST quickly). Callers fall back to REST when no fresh WS book exists.
 */
export class BookFeed {
  private books = new Map<string, { book: L2Book | null; receivedAt: number; lastRead: number; unsub: () => void }>()
  private timer: ReturnType<typeof setInterval>
  stats = { wsHits: 0, misses: 0, subscriptions: 0 }
  constructor(private readonly ws: HlWsMultiplexer, private readonly now: () => number = Date.now, private readonly opts: { idleMs?: number; maxSubs?: number } = {}) {
    this.timer = setInterval(() => this.sweep(), 30_000)
    this.timer.unref?.()
  }
  /** Latest WS book if younger than maxAgeMs; otherwise null (and ensures a subscription exists for next time). */
  get(coin: string, maxAgeMs: number): L2Book | null {
    const t = this.now()
    let e = this.books.get(coin)
    if (!e) {
      if (this.books.size >= (this.opts.maxSubs ?? 60)) { this.stats.misses++; return null }
      const entry = { book: null as L2Book | null, receivedAt: 0, lastRead: t, unsub: () => {} }
      entry.unsub = this.ws.subscribe({ type: 'l2Book', coin }, (d) => { entry.book = d as L2Book; entry.receivedAt = this.now() })
      this.books.set(coin, entry); this.stats.subscriptions = this.books.size
      e = entry
    }
    e.lastRead = t
    if (e.book && t - e.receivedAt <= maxAgeMs) { this.stats.wsHits++; return e.book }
    this.stats.misses++
    return null
  }
  private sweep() {
    const t = this.now()
    for (const [coin, e] of this.books) if (t - e.lastRead > (this.opts.idleMs ?? 120_000)) { e.unsub(); this.books.delete(coin) }
    this.stats.subscriptions = this.books.size
  }
  close() { clearInterval(this.timer); for (const e of this.books.values()) e.unsub(); this.books.clear() }
}
