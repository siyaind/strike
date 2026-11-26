import { describe, expect, it, vi } from 'vitest'
import { InfoClient, HlHttpError } from './info'

describe('InfoClient request construction', () => {
  it('routes by env and lowercases users', async () => {
    const f = vi.fn(async (..._a: any[]) => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }))
    const t = new InfoClient({ env: 'testnet', fetch: f as any })
    await t.clearinghouseState('0xABCDEF')
    expect((f.mock.calls as any)[0][0]).toBe('https://api.hyperliquid-testnet.xyz/info')
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ type: 'clearinghouseState', user: '0xabcdef' })
    const m = new InfoClient({ env: 'mainnet', fetch: f as any })
    await m.candleSnapshot('BTC', '1h', 1, 2)
    expect((f.mock.calls as any)[1][0]).toBe('https://api.hyperliquid.xyz/info')
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: 1, endTime: 2 } })
  })
  it('maps HTTP errors and timeouts to typed errors (never fake success)', async () => {
    const bad = new InfoClient({ env: 'mainnet', fetch: (async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' })) as any })
    await expect(bad.allMids()).rejects.toMatchObject({ status: 429, kind: 'http' })
    const slow = new InfoClient({ env: 'mainnet', timeoutMs: 20, fetch: ((_u: string, i: any) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any })
    await expect(slow.allMids()).rejects.toBeInstanceOf(HlHttpError)
    await expect(slow.allMids()).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('InfoClient 429 handling', () => {
  it('retries a read once after HTTP 429, then succeeds', async () => {
    let n = 0
    const f = vi.fn(async () => (++n === 1 ? { ok: false, status: 429, text: async () => 'null', json: async () => null } : { ok: true, status: 200, text: async () => '{}', json: async () => ({ ok: 1 }) }))
    const c = new InfoClient({ env: 'mainnet', fetch: f as any }); c.retryDelayMs = 1
    expect(await c.post({ type: 'allMids' })).toEqual({ ok: 1 }); expect(f).toHaveBeenCalledTimes(2)
  })
  it('a second 429 surfaces as HlHttpError (no retry loop)', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'null', json: async () => null }))
    const c = new InfoClient({ env: 'mainnet', fetch: f as any }); c.retryDelayMs = 1
    await expect(c.post({ type: 'allMids' })).rejects.toMatchObject({ status: 429 }); expect(f).toHaveBeenCalledTimes(2)
  })
})
