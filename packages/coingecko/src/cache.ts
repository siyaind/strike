import { systemClock, type Clock } from '@strike/shared'

export interface CacheEntry<T> { value: T; fetchedAt: number; expiresAt: number }

/** Shared TTL cache with in-flight request de-duplication and stale fallback. */
export class SharedCache {
  private store = new Map<string, CacheEntry<unknown>>()
  private inflight = new Map<string, Promise<unknown>>()
  constructor(private readonly clock: Clock = systemClock, private readonly maxEntries = 500) {}

  get<T>(key: string): CacheEntry<T> | undefined { return this.store.get(key) as CacheEntry<T> | undefined }
  isFresh(key: string) { const e = this.store.get(key); return !!e && e.expiresAt > this.clock.now() }

  set<T>(key: string, value: T, ttlMs: number) {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = [...this.store.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0]
      if (oldest) this.store.delete(oldest[0])
    }
    const now = this.clock.now()
    this.store.set(key, { value, fetchedAt: now, expiresAt: now + ttlMs })
  }

  /** Returns fresh cache, else joins an in-flight fetch for the same key, else fetches once. */
  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<{ value: T; fetchedAt: number; fromCache: boolean; stale: boolean }> {
    const e = this.store.get(key) as CacheEntry<T> | undefined
    if (e && e.expiresAt > this.clock.now()) return { value: e.value, fetchedAt: e.fetchedAt, fromCache: true, stale: false }
    let p = this.inflight.get(key) as Promise<T> | undefined
    const joined = !!p
    if (!p) {
      p = fetcher().finally(() => this.inflight.delete(key))
      this.inflight.set(key, p)
    }
    try {
      const value = await p
      if (!joined) this.set(key, value, ttlMs)
      const ent = this.store.get(key)!
      return { value, fetchedAt: ent.fetchedAt, fromCache: joined, stale: false }
    } catch (err) {
      if (e) return { value: e.value, fetchedAt: e.fetchedAt, fromCache: true, stale: true }
      throw err
    }
  }
  size() { return this.store.size }
}
