import type { ClearinghouseState, FrontendOpenOrder } from '@strike/hyperliquid'
import { deriveProtection, type ProtectionStatus } from '@strike/protection'
import type { MarketService } from './market'
import type { User } from '../store'

export interface PositionOut {
  coin: string; side: 'long' | 'short'; szi: number; size: number; entryPx: number; markPx: number | null; oraclePx: number | null
  liquidationPx: number | null; liquidationSource: 'exchange' | 'simulated-approximation' | 'unavailable'
  unrealizedPnl: number | null; leverage: number; marginMode: 'cross' | 'isolated'; marginUsed: number; notionalUsd: number | null
  fundingHourly: number | null; cumFundingSinceOpen: number | null
  stopPx: number | null; takeProfitPx: number | null; protection: ProtectionStatus
  label: 'SIMULATED ACCOUNT' | 'TESTNET ACCOUNT' | 'WATCH-ONLY (MAINNET)' | 'WATCH-ONLY (TESTNET)'
}
export interface Portfolio {
  mode: User['mode']; env: 'simulated' | 'mainnet' | 'testnet'; account: string | null
  accountValue: number | null; totalMarginUsed: number | null; withdrawable: number | null
  positions: PositionOut[]; openOrders: FrontendOpenOrder[] | null
  dataTs: number; marketTs: number; labels: string[]; note: string | null
}

export const DEMO_SEED: Array<{ coin: string; side: 'long' | 'short'; usd: number; lev: number; entryOffset: number; stopPct: number | null; tpPct: number | null }> = [
  { coin: 'BTC', side: 'long', usd: 1500, lev: 3, entryOffset: -0.012, stopPct: -0.04, tpPct: 0.06 },
  { coin: 'ETH', side: 'short', usd: 800, lev: 5, entryOffset: 0.008, stopPct: null, tpPct: null },
  { coin: 'SOL', side: 'long', usd: 400, lev: 2, entryOffset: 0.015, stopPct: -0.05, tpPct: null },
]

export async function seedDemo(u: User, ms: MarketService, now: number) {
  if (u.demoSeeded || !u.ledger) return
  const m = await ms.markets('mainnet')
  for (const s of DEMO_SEED) {
    const snap = m.snaps.find((x) => x.coin === s.coin)
    if (!snap) continue
    const entry = snap.markPx * (1 + s.entryOffset)
    const step = 10 ** -snap.szDecimals
    const sz = Math.floor(s.usd / entry / step) * step
    u.ledger.positions.set(s.coin, { coin: s.coin, szi: s.side === 'long' ? sz : -sz, entryPx: entry, leverage: s.lev, stopPx: s.stopPct ? entry * (1 + s.stopPct * (s.side === 'long' ? 1 : -1)) : null, takeProfitPx: s.tpPct ? entry * (1 + s.tpPct * (s.side === 'long' ? 1 : -1)) : null, openedAt: now })
  }
  u.demoSeeded = true
}

export async function getPortfolio(u: User, ms: MarketService, now: number): Promise<Portfolio> {
  if (u.mode === 'guest') {
    await seedDemo(u, ms, now)
    const m = await ms.markets('mainnet')
    const L = u.ledger!
    const positions: PositionOut[] = [...L.positions.values()].map((p) => {
      const s = m.snaps.find((x) => x.coin === p.coin)
      const mark = s?.markPx ?? null
      const simOrders = [] as any[]
      if (p.stopPx) simOrders.push({ coin: p.coin, oid: -1, side: p.szi > 0 ? 'A' : 'B', sz: String(Math.abs(p.szi)), isTrigger: true, triggerPx: String(p.stopPx), reduceOnly: true, orderType: 'Stop Market' })
      if (p.takeProfitPx) simOrders.push({ coin: p.coin, oid: -2, side: p.szi > 0 ? 'A' : 'B', sz: String(Math.abs(p.szi)), isTrigger: true, triggerPx: String(p.takeProfitPx), reduceOnly: true, orderType: 'Take Profit Market' })
      return {
        coin: p.coin, side: p.szi > 0 ? 'long' : 'short', szi: p.szi, size: Math.abs(p.szi), entryPx: p.entryPx, markPx: mark, oraclePx: s?.oraclePx ?? null,
        liquidationPx: L.simLiqPx(p), liquidationSource: 'simulated-approximation',
        unrealizedPnl: mark == null ? null : (mark - p.entryPx) * p.szi, leverage: p.leverage, marginMode: 'isolated', marginUsed: (Math.abs(p.szi) * p.entryPx) / p.leverage,
        notionalUsd: mark == null ? null : Math.abs(p.szi) * mark, fundingHourly: s?.fundingHourly ?? null, cumFundingSinceOpen: null,
        stopPx: p.stopPx, takeProfitPx: p.takeProfitPx, protection: deriveProtection({ coin: p.coin, positionSzi: p.szi, openOrders: simOrders, source: 'simulated-ledger' }), label: 'SIMULATED ACCOUNT',
      }
    })
    const margin = positions.reduce((a, p) => a + p.marginUsed, 0)
    const upnl = positions.reduce((a, p) => a + (p.unrealizedPnl ?? 0), 0)
    return { mode: 'guest', env: 'simulated', account: `guest:${u.id.slice(-6)}`, accountValue: L.cash + upnl, totalMarginUsed: margin, withdrawable: L.cash - margin, positions, openOrders: [], dataTs: now, marketTs: m.ts, labels: ['SIMULATED ACCOUNT', m.stale ? 'STALE PUBLIC MARKET DATA' : 'LIVE PUBLIC MARKET DATA'], note: 'Illustrative demo positions seeded at live prices. Liquidation prices are a simulated isolated-margin approximation.' }
  }
  const addr = u.address
  if (!addr) return { mode: u.mode, env: u.accountEnv, account: null, accountValue: null, totalMarginUsed: null, withdrawable: null, positions: [], openOrders: null, dataTs: now, marketTs: now, labels: [], note: 'No account connected' }
  const env = u.accountEnv
  const info = env === 'mainnet' ? ms.mainnet : ms.testnet
  const [ch, oo, m] = await Promise.all([info.clearinghouseState(addr) as Promise<ClearinghouseState>, info.frontendOpenOrders(addr).catch(() => null), ms.markets(env)])
  const label = u.mode === 'watch' ? (env === 'mainnet' ? 'WATCH-ONLY (MAINNET)' : 'WATCH-ONLY (TESTNET)') : 'TESTNET ACCOUNT'
  const positions: PositionOut[] = ch.assetPositions.map(({ position: p }) => {
    const szi = Number(p.szi)
    const s = m.snaps.find((x) => x.coin === p.coin)
    const prot = deriveProtection({ coin: p.coin, positionSzi: szi, openOrders: oo as any })
    return {
      coin: p.coin, side: szi > 0 ? 'long' : 'short', szi, size: Math.abs(szi), entryPx: Number(p.entryPx), markPx: s?.markPx ?? null, oraclePx: s?.oraclePx ?? null,
      liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null, liquidationSource: p.liquidationPx ? 'exchange' : 'unavailable',
      unrealizedPnl: Number(p.unrealizedPnl), leverage: p.leverage.value, marginMode: p.leverage.type, marginUsed: Number(p.marginUsed), notionalUsd: Number(p.positionValue),
      fundingHourly: s?.fundingHourly ?? null, cumFundingSinceOpen: Number(p.cumFunding.sinceOpen),
      stopPx: prot.stop?.triggerPx ?? null, takeProfitPx: prot.takeProfit?.triggerPx ?? null, protection: prot, label,
    }
  })
  return { mode: u.mode, env, account: addr, accountValue: Number(ch.marginSummary.accountValue), totalMarginUsed: Number(ch.marginSummary.totalMarginUsed), withdrawable: Number(ch.withdrawable), positions, openOrders: oo, dataTs: ch.time ?? now, marketTs: m.ts, labels: [label, env === 'mainnet' ? 'MAINNET READ-ONLY' : 'TESTNET'], note: u.mode === 'watch' ? 'Viewing an address does not imply control of it.' : null }
}
