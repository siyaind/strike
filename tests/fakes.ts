import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(__dirname, 'fixtures')
const j = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
export const FX = {
  mainMeta: j('hl-mainnet-metaAndAssetCtxs.json'), testMeta: j('hl-testnet-metaAndAssetCtxs.json'),
  books: Object.fromEntries(['BTC', 'ETH', 'SOL', 'HYPE'].map((c) => [c, j(`hl-mainnet-l2Book-${c}.json`)])),
  candles: j('hl-mainnet-candles-BTC-1h.json'), funding: j('hl-mainnet-fundingHistory-BTC.json'), trending: j('cg-trending.json'),
}
export const T0: number = FX.books.BTC.time + 500
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

export interface FakeOpts { failMainnet?: 'timeout' | 'http500' | null; failCg?: number | null; testnetExchange?: (body: any) => unknown; testnetInfo?: (body: any) => unknown; calls?: { main: number; test: number; cg: number; exchange: any[] }; bookTime?: () => number }
export function fakes(o: FakeOpts = {}) {
  const calls = o.calls ?? { main: 0, test: 0, cg: 0, exchange: [] as any[] }
  const book = (coin: string, now?: number) => ({ ...(FX.books[coin] ?? FX.books.BTC), coin, time: now ?? o.bookTime?.() ?? FX.books.BTC.time })
  const fetchMainnet = async (_url: string, init: any) => {
    calls.main++
    if (o.failMainnet === 'http500') return res({ error: 'x' }, 500)
    if (o.failMainnet === 'timeout') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const b = JSON.parse(init.body)
    switch (b.type) {
      case 'metaAndAssetCtxs': return res(FX.mainMeta)
      case 'l2Book': return res(book(b.coin))
      case 'candleSnapshot': return res(FX.candles)
      case 'fundingHistory': return res(FX.funding)
      case 'userRole': return res({ role: 'user' })
      case 'clearinghouseState': return res({ assetPositions: [], marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' }, crossMarginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' }, crossMaintenanceMarginUsed: '0', withdrawable: '0', time: T0 })
      case 'frontendOpenOrders': return res([])
      default: return res(null)
    }
  }
  const fetchTestnet = async (url: string, init: any) => {
    calls.test++
    const b = JSON.parse(init.body)
    if (url.endsWith('/exchange')) { calls.exchange.push(b); return res(o.testnetExchange ? o.testnetExchange(b) : { status: 'err', response: 'User or API Wallet 0x0 does not exist.' }) }
    if (o.testnetInfo) { const r = o.testnetInfo(b); if (r !== undefined) return res(r) }
    switch (b.type) {
      case 'metaAndAssetCtxs': return res(FX.testMeta)
      case 'l2Book': return res(book(b.coin))
      default: return fetchMainnet(url, init)
    }
  }
  const fetchCoingecko = async () => { calls.cg++; if (o.failCg) return res({ status: { error_code: o.failCg } }, o.failCg); return res(FX.trending) }
  return { fetchMainnet, fetchTestnet, fetchCoingecko, calls }
}
