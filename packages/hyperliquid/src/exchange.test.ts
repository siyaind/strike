import { describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { TestnetExchangeClient, orderAction, orderWire, ActionNotAllowedError } from './exchange'
import { parseExchangeResponse } from './responses'
import { recoverL1Signer } from './signing'

const acct = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123')

describe('exchange response parsing (HTTP 200 is not success)', () => {
  it('resting', () => {
    const p = parseExchangeResponse({ status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 77738308 } }] } } })
    expect(p.ok).toBe(true); expect(p.statuses[0]).toEqual({ kind: 'resting', oid: 77738308, cloid: undefined })
  })
  it('filled', () => {
    const p = parseExchangeResponse({ status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { totalSz: '0.02', avgPx: '1891.4', oid: 77747314 } }] } } })
    expect(p.statuses[0]).toMatchObject({ kind: 'filled', totalSz: '0.02', avgPx: '1891.4' })
  })
  it('nested per-order error inside status ok', () => {
    const p = parseExchangeResponse({ status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Order must have minimum value of $10.' }] } } })
    expect(p.ok).toBe(false); expect(p.statuses[0]).toEqual({ kind: 'error', message: 'Order must have minimum value of $10.' })
  })
  it('top-level err', () => {
    const p = parseExchangeResponse({ status: 'err', response: 'User or API Wallet 0xabc does not exist.' })
    expect(p.ok).toBe(false); expect(p.topLevelError).toMatch(/does not exist/)
  })
  it('garbage', () => { expect(parseExchangeResponse(null).ok).toBe(false) })
  it('mixed batch: one error makes ok=false', () => {
    const p = parseExchangeResponse({ status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 1 } }, { error: 'x' }] } } })
    expect(p.ok).toBe(false)
  })
})

describe('TestnetExchangeClient', () => {
  it('posts a correctly signed body to the testnet URL', async () => {
    const fetch = vi.fn(async (_url: string, init: any) => ({ ok: true, status: 200, json: async () => ({ status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 5 } }] } } }), text: async () => '' , _init: init }))
    const c = new TestnetExchangeClient(acct, { next: () => 1700000000000 }, { env: 'testnet', fetch: fetch as any })
    const action = orderAction([orderWire({ asset: 3, isBuy: true, px: '50000', sz: '0.001', reduceOnly: false, type: { limit: { tif: 'Gtc' } } })])
    const r = await c.submit(action)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.hyperliquid-testnet.xyz/exchange')
    const body = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(body.nonce).toBe(1700000000000)
    expect((await recoverL1Signer(body.action, body.signature, body.nonce, 'testnet')).toLowerCase()).toBe(acct.address.toLowerCase())
    expect(r.parsed.statuses[0]).toMatchObject({ kind: 'resting', oid: 5 })
  })
  it.each(['withdraw3', 'usdSend', 'spotSend', 'usdClassTransfer', 'vaultTransfer', 'sendAsset', 'approveBuilderFee', 'approveAgent'])('rejects fund-moving / privileged action %s', async (type) => {
    const c = new TestnetExchangeClient(acct, { next: () => 1 }, { env: 'testnet', fetch: vi.fn() as any })
    await expect(c.submit({ type } as any)).rejects.toBeInstanceOf(ActionNotAllowedError)
  })
  it('rejects builder fee attachment', async () => {
    const c = new TestnetExchangeClient(acct, { next: () => 1 }, { env: 'testnet', fetch: vi.fn() as any })
    await expect(c.submit({ ...orderAction([]), builder: { b: '0x0', f: 10 } } as any)).rejects.toBeInstanceOf(ActionNotAllowedError)
  })
})
