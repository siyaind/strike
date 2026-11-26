import { describe, expect, it } from 'vitest'
import { HlWsMultiplexer } from '@strike/hyperliquid'
import { BookFeed } from './bookfeed'

function fakeWs() {
  const sent: any[] = []
  let sock: any
  const mux = new HlWsMultiplexer('mainnet', () => { sock = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)), close() {}, onopen: null, onclose: null, onmessage: null, onerror: null }; return sock })
  mux.connect(); sock.onopen()
  return { mux, sent, push: (data: unknown) => sock.onmessage({ data: JSON.stringify({ channel: 'l2Book', data }) }) }
}
describe('BookFeed (WS books)', () => {
  it('subscribes once per coin, serves fresh WS books, falls back (null) when stale', () => {
    let t = 1000; const w = fakeWs(); const f = new BookFeed(w.mux, () => t)
    expect(f.get('BTC', 1500)).toBeNull()
    expect(w.sent.filter((m) => m.method === 'subscribe' && m.subscription.coin === 'BTC')).toHaveLength(1)
    const book = { coin: 'BTC', time: 1000, levels: [[{ px: '1', sz: '1', n: 1 }], [{ px: '2', sz: '1', n: 1 }]] }
    w.push(book)
    expect(f.get('BTC', 1500)).toEqual(book); f.get('BTC', 1500)
    expect(w.sent.filter((m) => m.method === 'subscribe')).toHaveLength(1)
    t += 2000; expect(f.get('BTC', 1500)).toBeNull()
    expect(f.stats.wsHits).toBe(2); f.close()
  })
  it('caps subscriptions', () => { const w = fakeWs(); const f = new BookFeed(w.mux, Date.now, { maxSubs: 2 }); f.get('A', 1); f.get('B', 1); f.get('C', 1); expect(f.stats.subscriptions).toBe(2); f.close() })
})
