import type { LocalAccount } from 'viem'
import { TestnetExchangeClient, orderAction, orderWire, updateLeverageAction, parseExchangeResponse, roundPrice } from '@strike/hyperliquid'
import { buildProposal, materialChange, OrderLifecycle, type MarketState, type OrderProposal, type TradeIntent, ConfirmationRegistry } from '@strike/trading-core'
import { liquidityLens } from '@strike/market-intelligence'
import { deriveProtection, protectiveOrderParams } from '@strike/protection'
import { randomBytes } from 'node:crypto'
import type { MarketService } from './market'
import type { Receipt, Store, User } from '../store'
import { getPortfolio } from './account'
import type { NonceAllocator } from '@strike/signer'

export interface TradeDeps { ms: MarketService; store: Store; confirmations: ConfirmationRegistry; nonces: NonceAllocator; signerFor: (userId: string) => { account: LocalAccount; masterAddress: string }; testnetFetch?: typeof fetch; now: () => number }

/** Market state for proposal construction. Execution env: guest → simulated (live mainnet public book), wallet → testnet. */
export async function marketState(d: TradeDeps, u: User, coin: string, fresh: boolean): Promise<MarketState> {
  const env = u.mode === 'guest' ? 'mainnet' : 'testnet'
  if (u.mode === 'watch') throw Object.assign(new Error('Watch-only accounts cannot trade'), { statusCode: 403 })
  const m = await d.ms.markets(env)
  const inst = m.meta.perp(coin)
  const snap = m.snaps.find((s) => s.coin === inst.coin)
  const book = fresh ? await d.ms.freshBook(inst.coin, env) : await d.ms.book(inst.coin, env)
  const lens = liquidityLens(book, d.now(), [100])
  const pf = await getPortfolio(u, d.ms, d.now())
  const pos = pf.positions.find((p) => p.coin === inst.coin)
  return {
    env: u.mode === 'guest' ? 'simulated' : 'testnet', assetId: inst.assetId, szDecimals: inst.szDecimals, maxLeverage: inst.maxLeverage ?? 1,
    bestBid: lens.bestBid, bestAsk: lens.bestAsk, markPx: snap?.markPx ?? lens.mid ?? 0, estSlippageBps: lens.estimates[0]?.slippageBps ?? null,
    positionSzi: pos?.szi ?? 0, accountValueUsd: pf.accountValue, marginUsedUsd: pf.totalMarginUsed,
    otherExposureUsd: pf.positions.filter((p) => p.coin !== inst.coin).reduce((a, p) => a + (p.notionalUsd ?? 0), 0),
    openOrders: pf.openOrders?.length ?? 0, sessionNotionalUsedUsd: u.sessionNotionalUsd, snapshotTs: Math.min(book.time, m.ts),
  }
}

export async function preview(d: TradeDeps, u: User, intent: TradeIntent, cgId?: string | null) {
  // Discovery via CoinGecko must pass a VERIFIED mapping before any order is prepared.
  if (cgId) { const mp = d.ms.registry.byCoingecko(cgId); if (!mp || mp.status !== 'verified' || mp.hlPerp?.toUpperCase() !== intent.coin.toUpperCase()) throw Object.assign(new Error(`CoinGecko asset '${cgId}' has no verified Hyperliquid mapping; orders are blocked`), { statusCode: 422 }) }
  const m = await marketState(d, u, intent.coin, true)
  const p = buildProposal({ userId: u.id, accountId: u.address ?? `guest:${u.id}`, intent, m, policy: u.policy, now: d.now() })
  const token = d.confirmations.register(p)
  d.store.audit(u, 'proposal', `${p.proposalId} ${p.instrument.coin} ${p.wire.isBuy ? 'BUY' : 'SELL'} ${p.wire.sz} @${p.wire.px} ${p.env} risk=${p.risk.ok}`)
  return { proposal: p, confirmToken: token, label: p.env === 'simulated' ? 'SIMULATED EXECUTION' : 'TESTNET EXECUTION' }
}

/** Confirm → revalidate on fresh data → execute once → reconcile. Never auto-retries. */
export async function confirm(d: TradeDeps, u: User, proposalId: string, token: string): Promise<Receipt> {
  const p = d.confirmations.claim(proposalId, token, u.id) // single-use claim BEFORE any side effect
  const life = new OrderLifecycle(d.now)
  life.to('VALIDATED', 'built + precision ok').to('AWAITING_CONFIRMATION', 'previewed').to('CONFIRMED', 'user confirmed')
  const fresh = await marketState(d, u, p.instrument.coin, true)
  const change = materialChange(p, fresh)
  const receipt: Receipt = { id: `rcpt_${randomBytes(8).toString('hex')}`, proposalId: p.proposalId, env: p.env === 'simulated' ? 'simulated' : 'testnet', label: p.env === 'simulated' ? 'SIMULATED EXECUTION' : 'TESTNET EXECUTION', coin: p.instrument.coin, side: p.wire.isBuy ? 'buy' : 'sell', status: 'CONFIRMED', requestedSz: p.wire.sz, filledSz: '0', avgPx: null, oid: null, cloid: null, exchangeResponse: null, transitions: life.history, createdAt: d.now(), reconciled: false }
  if (change) { life.to('INVALIDATED', change); receipt.status = 'INVALIDATED'; receipt.exchangeResponse = { reason: change }; u.receipts.push(receipt); return receipt }
  if (p.env === 'simulated') {
    life.to('SUBMITTING', 'simulated ledger')
    const book = await d.ms.freshBook(p.instrument.coin, 'mainnet')
    const r = u.ledger!.execute({ proposalId: p.proposalId, coin: p.instrument.coin, isBuy: p.wire.isBuy, sz: Number(p.wire.sz), limitPx: Number(p.wire.px), reduceOnly: p.wire.reduceOnly, leverage: p.leverage, book, now: d.now(), protection: { stopPx: p.protection.stopPx ? Number(p.protection.stopPx) : null, takeProfitPx: p.protection.takeProfitPx ? Number(p.protection.takeProfitPx) : null } })
    life.to(r.status, r.reason ?? 'local fill against live public book')
    Object.assign(receipt, { status: r.status, filledSz: String(r.filledSz), avgPx: r.avgPx == null ? null : String(r.avgPx), exchangeResponse: { simulated: true, ...r }, reconciled: true })
    if (!p.wire.reduceOnly && r.filledSz > 0) u.sessionNotionalUsd += r.filledSz * (r.avgPx ?? 0)
    receipt.transitions = life.history; u.receipts.push(receipt); return receipt
  }
  // ── TESTNET ──
  const { account, masterAddress } = d.signerFor(u.id)
  if (masterAddress !== u.address) throw new Error('Signer/account mismatch')
  const client = new TestnetExchangeClient(account, d.nonces, { env: 'testnet', fetch: d.testnetFetch as any })
  if (!p.wire.reduceOnly && p.instrument.kind === 'perp') {
    const lev = await client.submit(updateLeverageAction(p.instrument.assetId, true, p.leverage))
    if (!lev.parsed.ok) { life.to('REJECTED', `leverage: ${lev.parsed.topLevelError ?? JSON.stringify(lev.raw)}`); Object.assign(receipt, { status: 'REJECTED', exchangeResponse: lev.raw }); receipt.transitions = life.history; u.receipts.push(receipt); return receipt }
  }
  const cloid = `0x${randomBytes(16).toString('hex')}`
  receipt.cloid = cloid
  life.to('SUBMITTING', 'signed testnet order')
  let res
  try {
    res = await client.submit(orderAction([orderWire({ asset: p.instrument.assetId, isBuy: p.wire.isBuy, px: p.wire.px, sz: p.wire.sz, reduceOnly: p.wire.reduceOnly, type: { limit: { tif: p.wire.tif } }, cloid })]))
  } catch (e) {
    life.to('UNKNOWN', `transport: ${(e as Error).message}`)
    receipt.status = 'UNKNOWN'; receipt.transitions = life.history; u.receipts.push(receipt)
    await reconcile(d, u, receipt).catch(() => {})
    return receipt
  }
  receipt.exchangeResponse = res.raw
  const st = res.parsed.statuses[0]
  if (!res.parsed.ok || !st) life.to('REJECTED', res.parsed.topLevelError ?? (st && st.kind === 'error' ? st.message : 'unrecognised response'))
  else if (st.kind === 'filled') { life.to(Number(st.totalSz) + 1e-12 >= Number(p.wire.sz) ? 'FILLED' : 'PARTIALLY_FILLED', 'exchange filled'); Object.assign(receipt, { oid: st.oid, filledSz: st.totalSz, avgPx: st.avgPx }) }
  else if (st.kind === 'resting') { life.to('ACCEPTED', 'resting on book'); receipt.oid = st.oid }
  else life.to('UNKNOWN', `status ${st.kind}`)
  receipt.status = life.state
  if (receipt.oid) u.knownOids.add(receipt.oid)
  if (!p.wire.reduceOnly && Number(receipt.filledSz) > 0) u.sessionNotionalUsd += Number(receipt.filledSz) * Number(receipt.avgPx)
  receipt.transitions = life.history; u.receipts.push(receipt)
  await reconcile(d, u, receipt).catch(() => {})
  // Protected entry: place reduce-only stop for the ACTUAL filled size, then verify from exchange state.
  if (p.protection.stopPx && Number(receipt.filledSz) > 0) receipt.protection = await placeStop(d, u, p, Number(receipt.filledSz) * (p.wire.isBuy ? 1 : -1), Number(p.protection.stopPx), client)
  return receipt
}

export async function reconcile(d: TradeDeps, u: User, r: Receipt) {
  if (r.env !== 'testnet' || !u.address) return r
  const q = await d.ms.testnet.orderStatus(u.address, r.oid ?? (r.cloid as string))
  if (q.status === 'order' && q.order) {
    const s = q.order.status
    const map: Record<string, string> = { filled: 'FILLED', open: 'ACCEPTED', canceled: 'CANCELED', rejected: 'REJECTED', marginCanceled: 'CANCELED', triggered: 'ACCEPTED' }
    if (map[s]) r.status = map[s]!
    r.oid = q.order.order.oid
  } else if (r.status === 'UNKNOWN') r.status = 'UNKNOWN' // still unknown — surfaced to user, never retried
  r.reconciled = true
  return r
}

export async function placeStop(d: TradeDeps, u: User, p: Pick<OrderProposal, 'instrument'>, positionSzi: number, stopPx: number, client?: TestnetExchangeClient) {
  const m = await d.ms.markets('testnet')
  const inst = m.meta.perp(p.instrument.coin)
  const params = protectiveOrderParams({ positionSzi, triggerPx: stopPx, kind: 'sl', slippageBps: 300 })
  const c = client ?? new TestnetExchangeClient(d.signerFor(u.id).account, d.nonces, { env: 'testnet', fetch: d.testnetFetch as any })
  const wire = orderWire({ asset: inst.assetId, isBuy: params.isBuy, px: roundPrice(params.limitPx, 'perp', inst.szDecimals, params.isBuy ? 'down' : 'up'), sz: String(params.sz), reduceOnly: true, type: { trigger: { isMarket: true, triggerPx: roundPrice(stopPx, 'perp', inst.szDecimals), tpsl: 'sl' } } })
  const res = await c.submit(orderAction([wire]))
  const ok = res.parsed.ok
  u.protectionLog.push({ t: d.now(), coin: inst.coin, ok, detail: ok ? `Stop ${wire.t && 'trigger' in wire.t ? wire.t.trigger.triggerPx : ''} submitted` : `Stop rejected: ${res.parsed.topLevelError ?? JSON.stringify(res.parsed.statuses)}` })
  const oo = await d.ms.testnet.frontendOpenOrders(u.address!).catch(() => null)
  const ch = await d.ms.testnet.clearinghouseState(u.address!).catch(() => null)
  const szi = ch ? Number(ch.assetPositions.find((a) => a.position.coin === inst.coin)?.position.szi ?? 0) : null
  return { submit: res.raw, verified: deriveProtection({ coin: inst.coin, positionSzi: szi, openOrders: oo as any, lastSubmitFailed: !ok }) }
}

export { parseExchangeResponse }
