import { describe, expect, it, vi } from 'vitest'
import { fixedClock } from '@strike/shared'
import { CoinGeckoClient, CgBudgetError, CgCircuitOpenError, COINGECKO_ATTRIBUTION, TTL } from './client'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('CoinGecko client', () => {
  it('sends demo key only as header, never in URL', async () => {
    const f = vi.fn(async () => ok({ coins: [] }))
    const c = new CoinGeckoClient({ apiKey: 'CG-secret', fetch: f as any })
    await c.trending()
    const [url, init] = f.mock.calls[0] as any
    expect(url).not.toContain('CG-secret'); expect(init.headers['x-cg-demo-api-key']).toBe('CG-secret')
    expect(c.mode).toBe('demo')
  })
  it('keyless mode uses public endpoint without header', async () => {
    const f = vi.fn(async () => ok({ coins: [] }))
    const c = new CoinGeckoClient({ fetch: f as any })
    await c.trending()
    expect((f.mock.calls[0] as any)[1].headers['x-cg-demo-api-key']).toBeUndefined(); expect(c.mode).toBe('public')
  })
  it('caches by TTL and dedupes concurrent requests to ONE upstream call', async () => {
    const clock = fixedClock(Date.UTC(2026, 10, 25))
    let resolve!: (v: any) => void
    const f = vi.fn(() => new Promise((r) => { resolve = r }))
    const c = new CoinGeckoClient({ fetch: f as any, clock, apiKey: 'k' })
    const ps = Array.from({ length: 25 }, () => c.trending())
    resolve(ok({ coins: [{ item: { id: 'bitcoin' } }] }))
    const rs = await Promise.all(ps)
    expect(f).toHaveBeenCalledTimes(1)
    expect(rs.every((r) => r.data.coins.length === 1)).toBe(true)
    await c.trending(); expect(f).toHaveBeenCalledTimes(1)
    clock.advance(TTL.trending + 1)
    f.mockImplementationOnce(async () => ok({ coins: [] }) as any)
    await c.trending(); expect(f).toHaveBeenCalledTimes(2)
    expect(c.usage().dedupedJoins + c.usage().hits).toBeGreaterThan(0)
  })
  it('batches market ids into one sorted, de-duplicated request', async () => {
    const f = vi.fn(async () => ok([]))
    const c = new CoinGeckoClient({ fetch: f as any, apiKey: 'k' })
    await c.markets(['ethereum', 'bitcoin', 'bitcoin'])
    expect((f.mock.calls[0] as any)[0]).toContain('ids=bitcoin%2Cethereum')
    await c.markets(['bitcoin', 'ethereum']); expect(f).toHaveBeenCalledTimes(1)
  })
  it('enforces monthly budget and serves stale cache when exhausted', async () => {
    const clock = fixedClock(Date.UTC(2026, 10, 25))
    const f = vi.fn(async () => ok({ coins: [{ item: { id: 'x' } }] }))
    const c = new CoinGeckoClient({ fetch: f as any, clock, apiKey: 'k', monthlyBudget: 1 })
    await c.trending()
    clock.advance(TTL.trending * 10)
    const r = await c.trending()
    expect(r.stale).toBe(true); expect(f).toHaveBeenCalledTimes(1)
    await expect(c.global()).rejects.toBeInstanceOf(CgBudgetError)
  })
  it('enforces per-minute rate limit', async () => {
    const f = vi.fn(async () => ok({}))
    const c = new CoinGeckoClient({ fetch: f as any, apiKey: 'k', perMinute: 2 })
    await c.coin('a'); await c.coin('b')
    await expect(c.coin('c')).rejects.toBeInstanceOf(CgBudgetError)
  })
  it('opens circuit after repeated 429s, then half-opens after cooldown', async () => {
    const clock = fixedClock(Date.UTC(2026, 10, 25))
    const f = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    const c = new CoinGeckoClient({ fetch: f as any, clock, apiKey: 'k' })
    for (const id of ['a', 'b', 'c']) await expect(c.coin(id)).rejects.toThrow(/429/)
    await expect(c.coin('d')).rejects.toBeInstanceOf(CgCircuitOpenError)
    expect(c.usage().circuit).toBe('open')
    clock.advance(61e3)
    expect(c.usage().circuit).toBe('half-open')
  })
  it('adaptive TTL stretches as budget is consumed', async () => {
    const f = vi.fn(async () => ok({}))
    const c = new CoinGeckoClient({ fetch: f as any, apiKey: 'k', monthlyBudget: 10, perMinute: 100 })
    expect(c.adaptiveTtl(1000)).toBe(1000)
    for (let i = 0; i < 8; i++) await c.coin(`c${i}`)
    expect(c.adaptiveTtl(1000)).toBe(4000)
  })
  it('usage never exposes the API key', () => {
    const c = new CoinGeckoClient({ apiKey: 'CG-supersecret' })
    expect(JSON.stringify(c.usage())).not.toContain('supersecret')
  })
  it('attribution present', () => { expect(COINGECKO_ATTRIBUTION.text).toMatch(/CoinGecko/) })
})
