import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY } from '@strike/risk-engine'
import { buildProposal, materialChange, ProposalError, type MarketState, type TradeIntent } from './proposal'
import { ConfirmationRegistry } from './confirm'
import { OrderLifecycle, IllegalTransitionError } from './lifecycle'
import { SimulatedLedger } from './ledger'

const m: MarketState = { env: 'testnet', assetId: 3, szDecimals: 5, maxLeverage: 40, bestBid: 99990, bestAsk: 100010, markPx: 100000, estSlippageBps: 1, positionSzi: 0, accountValueUsd: 1000, marginUsedUsd: 0, otherExposureUsd: 0, openOrders: 0, sessionNotionalUsedUsd: 0, snapshotTs: 1000 }
const buy: TradeIntent = { coin: 'BTC', kind: 'perp', side: 'buy', notionalUsd: 100, orderType: 'ioc-bounded', maxSlippageBps: 20, leverage: 3, reduceOnly: false }
const mk = (i: Partial<TradeIntent> = {}, mm: Partial<MarketState> = {}) => buildProposal({ userId: 'u1', accountId: 'a1', intent: { ...buy, ...i }, m: { ...m, ...mm }, policy: DEFAULT_POLICY, now: 2000 })

describe('proposal construction', () => {
  it('bounded IOC buy: cap rounded DOWN, valid tick, size rounded down', () => {
    const p = mk()
    expect(p.wire).toMatchObject({ isBuy: true, px: '100210', reduceOnly: false, tif: 'Ioc' })
    expect(Number(p.wire.sz)).toBeLessThanOrEqual(100 / 100210)
    expect(p.priceConstraint).toBe('Max buy price 100210')
    expect(p.risk.ok).toBe(true); expect(p.hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('sell floor rounded UP', () => { const p = mk({ side: 'sell' }); expect(Number(p.wire.px)).toBeGreaterThanOrEqual(99990 * (1 - 0.002)) })
  it('below $10 minimum rejected', () => { expect(() => mk({ notionalUsd: 5 })).toThrow(ProposalError) })
  it('reduce-only: opposite direction, capped to position, close half', () => {
    const p = mk({ side: 'sell', reduceOnly: true, notionalUsd: undefined, fractionOfPosition: 0.5 }, { positionSzi: 0.002 })
    expect(p.wire.sz).toBe('0.001'); expect(p.action).toBe('reduce')
    const full = mk({ side: 'sell', reduceOnly: true, notionalUsd: undefined, size: 1 }, { positionSzi: 0.002 })
    expect(full.wire.sz).toBe('0.002'); expect(full.action).toBe('close')
    expect(() => mk({ side: 'buy', reduceOnly: true, size: 0.001 }, { positionSzi: 0.002 })).toThrow(/opposite/)
    expect(() => mk({ side: 'sell', reduceOnly: true, size: 0.001 }, { positionSzi: 0 })).toThrow(/position/)
  })
  it('prevents accidental reversal', () => { expect(() => mk({ side: 'sell', notionalUsd: 500 }, { positionSzi: 0.002 })).toThrow(/reverse/) })
  it('no liquidity → error', () => { expect(() => mk({}, { bestAsk: null })).toThrow(/liquidity/) })
  it('risk failure recorded on proposal', () => { expect(mk({ leverage: 20 }).risk.ok).toBe(false) })
  it('material change detection', () => {
    const p = mk()
    expect(materialChange(p, m)).toBeNull()
    expect(materialChange(p, { ...m, bestAsk: 100500 })).toMatch(/above approved max/)
    expect(materialChange(p, { ...m, assetId: 4 })).toMatch(/Instrument/)
  })
})

describe('confirmation', () => {
  it('single-use, bound to params, user and expiry', () => {
    let t = 2000
    const reg = new ConfirmationRegistry('x'.repeat(32), () => t)
    const p = mk(); const tok = reg.register(p)
    expect(() => reg.claim(p.proposalId, tok, 'u2')).toThrow(/another user/)
    expect(() => reg.claim(p.proposalId, tok.slice(0, -2) + 'aa', 'u1')).toThrow(/token/)
    expect(reg.claim(p.proposalId, tok, 'u1').proposalId).toBe(p.proposalId)
    expect(() => reg.claim(p.proposalId, tok, 'u1')).toThrow(/already/)
    const p2 = mk(); const tok2 = reg.register(p2); t = p2.expiresAt + 1
    expect(() => reg.claim(p2.proposalId, tok2, 'u1')).toThrow(/expired/)
  })
  it('forged token for tampered params fails', () => {
    const reg = new ConfirmationRegistry('y'.repeat(32), () => 2000)
    const p = mk(); const tok = reg.register(p)
    const forged = { ...p, wire: { ...p.wire, sz: '1' }, hash: 'deadbeef' }
    expect(reg.token(forged)).not.toBe(tok)
  })
  it('risk-failed proposals cannot be confirmed', () => {
    const reg = new ConfirmationRegistry('z'.repeat(32), () => 2000)
    const p = mk({ leverage: 20 }); expect(() => reg.claim(p.proposalId, reg.register(p), 'u1')).toThrow(/Risk/)
  })
  it('100 concurrent confirms → exactly one succeeds', async () => {
    const reg = new ConfirmationRegistry('w'.repeat(32), () => 2000)
    const p = mk(); const tok = reg.register(p)
    const rs = await Promise.allSettled(Array.from({ length: 100 }, async () => reg.claim(p.proposalId, tok, 'u1')))
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })
})

describe('lifecycle', () => {
  it('legal path and illegal transitions', () => {
    const l = new OrderLifecycle(() => 1)
    l.to('VALIDATED', 'ok').to('AWAITING_CONFIRMATION', 'ok').to('CONFIRMED', 'ok').to('SUBMITTING', 'ok').to('UNKNOWN', 'timeout').to('FILLED', 'reconciled')
    expect(l.terminal).toBe(true); expect(l.history).toHaveLength(6)
    expect(() => new OrderLifecycle().to('SUBMITTING', 'skip')).toThrow(IllegalTransitionError)
  })
})

describe('simulated ledger', () => {
  const book = { coin: 'BTC', time: 1, levels: [[{ px: '99', sz: '1', n: 1 }], [{ px: '101', sz: '0.5', n: 1 }, { px: '103', sz: '5', n: 1 }]] } as any
  it('fills within bound only; partial when bound exhausts depth', () => {
    const l = new SimulatedLedger(1000)
    const r = l.execute({ proposalId: 'p', coin: 'BTC', isBuy: true, sz: 1, limitPx: 102, reduceOnly: false, leverage: 2, book, now: 1 })
    expect(r).toMatchObject({ status: 'PARTIALLY_FILLED', filledSz: 0.5, avgPx: 101 })
    expect(l.fills[0]!.label).toBe('SIMULATED EXECUTION')
  })
  it('reduce-only cannot increase or reverse', () => {
    const l = new SimulatedLedger(1000)
    l.execute({ proposalId: 'p', coin: 'BTC', isBuy: true, sz: 0.5, limitPx: 101, reduceOnly: false, leverage: 2, book, now: 1 })
    expect(l.execute({ proposalId: 'q', coin: 'BTC', isBuy: true, sz: 1, limitPx: 200, reduceOnly: true, leverage: 2, book, now: 2 }).status).toBe('REJECTED')
    const r = l.execute({ proposalId: 'r', coin: 'BTC', isBuy: false, sz: 5, limitPx: 1, reduceOnly: true, leverage: 2, book, now: 3 })
    expect(r.filledSz).toBe(0.5); expect(l.positions.has('BTC')).toBe(false)
  })
})
