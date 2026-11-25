import { describe, expect, it, vi } from 'vitest'
import { HlWsMultiplexer } from './ws'

function fakeFactory() {
  const sockets: any[] = []
  const factory = (url: string) => { const s: any = { url, readyState: 0, sent: [] as string[], send(d: string) { this.sent.push(d) }, close() { this.readyState = 3; this.onclose?.() }, onopen: null, onclose: null, onmessage: null, onerror: null }; sockets.push(s); return s }
  return { sockets, factory }
}

describe('WS multiplexer', () => {
  it('shares one upstream subscription across many listeners and unsubscribes when last leaves', () => {
    const { sockets, factory } = fakeFactory()
    const m = new HlWsMultiplexer('mainnet', factory)
    m.connect(); const s = sockets[0]; s.readyState = 1; s.onopen()
    const a = vi.fn(), b = vi.fn()
    const ua = m.subscribe({ type: 'l2Book', coin: 'BTC' }, a)
    const ub = m.subscribe({ type: 'l2Book', coin: 'BTC' }, b)
    expect(s.sent.filter((x: string) => x.includes('subscribe') && x.includes('l2Book')).length).toBe(1)
    s.onmessage({ data: JSON.stringify({ channel: 'l2Book', data: { coin: 'BTC', levels: [[], []], time: 1 } }) })
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce()
    ua(); expect(s.sent.some((x: string) => x.includes('unsubscribe'))).toBe(false)
    ub(); expect(s.sent.some((x: string) => x.includes('unsubscribe'))).toBe(true)
    m.close()
  })
  it('routes per-user channels only to that user (tenant isolation)', () => {
    const { sockets, factory } = fakeFactory()
    const m = new HlWsMultiplexer('testnet', factory)
    m.connect(); const s = sockets[0]; s.readyState = 1; s.onopen()
    const u1 = vi.fn(), u2 = vi.fn()
    m.subscribe({ type: 'userFills', user: '0xAAA' }, u1)
    m.subscribe({ type: 'userFills', user: '0xbbb' }, u2)
    s.onmessage({ data: JSON.stringify({ channel: 'userFills', data: { user: '0xaaa', fills: [] } }) })
    expect(u1).toHaveBeenCalledOnce(); expect(u2).not.toHaveBeenCalled()
    m.close()
  })
  it('reconnects after unexpected close and resubscribes; marks stale', async () => {
    vi.useFakeTimers()
    const { sockets, factory } = fakeFactory()
    const m = new HlWsMultiplexer('mainnet', factory, { reconnectBaseMs: 10 })
    m.connect(); sockets[0].readyState = 1; sockets[0].onopen()
    m.subscribe({ type: 'allMids' }, () => {})
    expect(m.isStale(1000)).toBe(true)
    sockets[0].onclose()
    expect(m.getStatus().state).toBe('closed')
    await vi.advanceTimersByTimeAsync(100)
    expect(sockets.length).toBe(2)
    sockets[1].readyState = 1; sockets[1].onopen()
    expect(sockets[1].sent.some((x: string) => x.includes('allMids'))).toBe(true)
    expect(m.getStatus().reconnects).toBe(1)
    m.close(); vi.useRealTimers()
  })
})
