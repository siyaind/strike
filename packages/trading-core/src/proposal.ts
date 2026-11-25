import { roundPrice, roundSizeDown, isValidPrice, isValidSize } from '@strike/hyperliquid'
import { evaluateRisk, type RiskPolicy, type RiskResult } from '@strike/risk-engine'
import { canonicalJson, randomId, sha256Hex } from '@strike/security'

/** Exchange minimum order value (Hyperliquid rejects orders below $10 notional). */
export const MIN_ORDER_USD = 10

export interface TradeIntent {
  coin: string; kind: 'perp' | 'spot'
  side: 'buy' | 'sell'
  notionalUsd?: number; size?: number; fractionOfPosition?: number // reduce helpers
  orderType: 'ioc-bounded' | 'limit-gtc' | 'limit-alo'
  limitPx?: number
  maxSlippageBps: number
  leverage: number
  reduceOnly: boolean
  protection?: { stopPx?: number; takeProfitPx?: number }
}
export interface MarketState {
  env: 'testnet' | 'simulated'
  assetId: number; szDecimals: number; maxLeverage: number
  bestBid: number | null; bestAsk: number | null; markPx: number; estSlippageBps: number | null
  positionSzi: number; accountValueUsd: number | null; marginUsedUsd: number | null; otherExposureUsd: number
  openOrders: number; sessionNotionalUsedUsd: number
  snapshotTs: number
}
export interface OrderProposal {
  proposalId: string; userId: string; accountId: string; env: MarketState['env']
  instrument: { coin: string; kind: 'perp' | 'spot'; assetId: number }
  action: 'open' | 'increase' | 'reduce' | 'close'
  wire: { isBuy: boolean; px: string; sz: string; reduceOnly: boolean; tif: 'Ioc' | 'Gtc' | 'Alo' }
  notionalUsd: number; leverage: number
  priceConstraint: string
  protection: { stopPx: string | null; takeProfitPx: string | null }
  risk: RiskResult
  snapshotTs: number; createdAt: number; expiresAt: number
  hash: string
}
export class ProposalError extends Error { constructor(readonly code: string, msg: string) { super(msg) } }

export function buildProposal(args: { userId: string; accountId: string; intent: TradeIntent; m: MarketState; policy: RiskPolicy; now: number; ttlMs?: number }): OrderProposal {
  const { intent: i, m, now } = args
  const kind = i.kind
  const ref = i.side === 'buy' ? m.bestAsk : m.bestBid
  if (i.orderType === 'ioc-bounded' && ref == null) throw new ProposalError('NO_LIQUIDITY', 'No visible liquidity on that side of the book')
  // Bounded price: never more aggressive than approved. Buy caps rounded DOWN, sell floors rounded UP.
  let px: string
  if (i.orderType === 'ioc-bounded') {
    const raw = i.side === 'buy' ? ref! * (1 + i.maxSlippageBps / 1e4) : ref! * (1 - i.maxSlippageBps / 1e4)
    px = roundPrice(raw, kind, m.szDecimals, i.side === 'buy' ? 'down' : 'up')
  } else {
    if (!i.limitPx || i.limitPx <= 0) throw new ProposalError('NO_LIMIT_PX', 'Limit price required')
    px = roundPrice(i.limitPx, kind, m.szDecimals, i.side === 'buy' ? 'down' : 'up')
  }
  const pxN = Number(px)
  const cur = m.positionSzi
  let sizeRaw: number
  if (i.fractionOfPosition != null) {
    if (cur === 0) throw new ProposalError('NO_POSITION', 'No position to reduce')
    sizeRaw = Math.abs(cur) * i.fractionOfPosition
  } else if (i.size != null) sizeRaw = i.size
  else if (i.notionalUsd != null) sizeRaw = i.notionalUsd / pxN
  else throw new ProposalError('NO_SIZE', 'Size or notional required')
  let sz = roundSizeDown(sizeRaw, m.szDecimals)
  if (i.reduceOnly) {
    if (cur === 0) throw new ProposalError('NO_POSITION', 'Reduce-only requires an open position')
    if ((cur > 0 && i.side !== 'sell') || (cur < 0 && i.side !== 'buy')) throw new ProposalError('WRONG_DIRECTION', 'Reduce-only order must be opposite to the position')
    if (Number(sz) > Math.abs(cur)) sz = roundSizeDown(Math.abs(cur), m.szDecimals) // never reverse
  }
  if (!isValidSize(sz, m.szDecimals)) throw new ProposalError('BAD_SIZE', `Size ${sz} invalid for szDecimals ${m.szDecimals}`)
  if (!isValidPrice(px, kind, m.szDecimals)) throw new ProposalError('BAD_PRICE', `Price ${px} invalid`)
  const notional = Number(sz) * pxN
  if (notional < MIN_ORDER_USD && !i.reduceOnly) throw new ProposalError('MIN_NOTIONAL', `Order value $${notional.toFixed(2)} below exchange minimum $${MIN_ORDER_USD}`)
  const signed = i.side === 'buy' ? Number(sz) : -Number(sz)
  const after = cur + signed
  const action: OrderProposal['action'] = i.reduceOnly ? (Math.abs(after) < 10 ** -m.szDecimals / 2 ? 'close' : 'reduce') : cur === 0 ? 'open' : Math.sign(cur) === Math.sign(signed) ? 'increase' : 'reduce'
  if (!i.reduceOnly && cur !== 0 && Math.sign(after) !== Math.sign(cur) && after !== 0) throw new ProposalError('REVERSAL', 'Order would reverse the position; close first, then open')
  const expAfter = Math.abs(after) * m.markPx
  const risk = evaluateRisk({
    coin: i.coin, reduceOnly: i.reduceOnly, orderNotionalUsd: notional, leverage: i.leverage, assetMaxLeverage: m.maxLeverage,
    positionExposureAfterUsd: expAfter, totalExposureAfterUsd: m.otherExposureUsd + expAfter,
    accountValueUsd: m.accountValueUsd, marginUsedAfterUsd: m.marginUsedUsd == null ? null : m.marginUsedUsd + (i.reduceOnly ? 0 : notional / i.leverage),
    availableCollateralUsd: m.accountValueUsd == null || m.marginUsedUsd == null ? null : m.accountValueUsd - m.marginUsedUsd - (i.reduceOnly ? 0 : notional / i.leverage),
    estSlippageBps: m.estSlippageBps, openOrders: m.openOrders, sessionNotionalUsedUsd: m.sessionNotionalUsedUsd,
    dataTs: m.snapshotTs, now, maxDataAgeMs: 15_000,
  }, args.policy)
  const prot = { stopPx: i.protection?.stopPx ? roundPrice(i.protection.stopPx, kind, m.szDecimals) : null, takeProfitPx: i.protection?.takeProfitPx ? roundPrice(i.protection.takeProfitPx, kind, m.szDecimals) : null }
  const core = {
    userId: args.userId, accountId: args.accountId, env: m.env, instrument: { coin: i.coin, kind, assetId: m.assetId }, action,
    wire: { isBuy: i.side === 'buy', px, sz, reduceOnly: i.reduceOnly, tif: (i.orderType === 'ioc-bounded' ? 'Ioc' : i.orderType === 'limit-alo' ? 'Alo' : 'Gtc') as 'Ioc' | 'Gtc' | 'Alo' },
    notionalUsd: notional, leverage: i.leverage, protection: prot, snapshotTs: m.snapshotTs,
  }
  const createdAt = now, expiresAt = now + (args.ttlMs ?? 30_000)
  const proposalId = randomId('prop_')
  const hash = sha256Hex(canonicalJson({ ...core, proposalId, expiresAt }))
  return { proposalId, ...core, priceConstraint: i.side === 'buy' ? `Max buy price ${px}` : `Min sell price ${px}`, risk, createdAt, expiresAt, hash }
}

/** On confirmation, compare fresh state to the snapshot the user approved. Any material change invalidates. */
export function materialChange(p: OrderProposal, fresh: MarketState): string | null {
  if (fresh.assetId !== p.instrument.assetId) return 'Instrument id changed'
  const ref = p.wire.isBuy ? fresh.bestAsk : fresh.bestBid
  if (ref == null) return 'Liquidity disappeared'
  if (p.wire.tif === 'Ioc') {
    if (p.wire.isBuy && ref > Number(p.wire.px)) return `Best ask ${ref} now above approved max ${p.wire.px}`
    if (!p.wire.isBuy && ref < Number(p.wire.px)) return `Best bid ${ref} now below approved min ${p.wire.px}`
  }
  if (p.wire.reduceOnly && Math.abs(fresh.positionSzi) + 1e-12 < Number(p.wire.sz) && p.action !== 'close') return 'Position size changed since preview'
  return null
}
