import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverTypedDataAddress, type Hex } from 'viem'
import fixtures from './fixtures/python-sdk-signing.json'
import { actionHash, approveAgentTypedData, recoverL1Signer, signL1Action, signL1ActionUnchecked } from './signing'
import { MainnetSigningBlockedError } from '@strike/shared'
import { TestnetExchangeClient } from './exchange'

const KEY = '0x0123456789012345678901234567890123456789012345678901234567890123' as Hex
const acct = privateKeyToAccount(KEY)
const big = (h: string) => BigInt(h)

describe('Hyperliquid signing matches official python SDK fixtures', () => {
  it('fixture address matches', () => expect(acct.address).toBe(fixtures.address))
  for (const c of fixtures.cases.filter((c) => c.kind === 'l1')) {
    it(`action hash + signature: ${c.name}`, async () => {
      const cc = c as any
      expect(actionHash(cc.action, cc.vault, cc.nonce, cc.expiresAfter)).toBe(cc.hash)
      const sig = await signL1ActionUnchecked(acct, cc.action, cc.nonce, cc.env, cc.vault, cc.expiresAfter)
      expect(big(sig.r)).toBe(big(cc.sig.r))
      expect(big(sig.s)).toBe(big(cc.sig.s))
      expect(sig.v).toBe(cc.sig.v)
      expect((await recoverL1Signer(cc.action, sig, cc.nonce, cc.env, cc.vault, cc.expiresAfter)).toLowerCase()).toBe(acct.address.toLowerCase())
    })
  }
  it('approveAgent typed data matches python SDK signature (testnet)', async () => {
    const c = fixtures.cases.find((c) => c.kind === 'approveAgent') as any
    const td = approveAgentTypedData(c.action.agentAddress, c.action.agentName, c.action.nonce, 'testnet')
    const sig = await acct.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message })
    expect(big('0x' + sig.slice(2, 66))).toBe(big(c.sig.r))
    expect(big('0x' + sig.slice(66, 130))).toBe(big(c.sig.s))
    const rec = await recoverTypedDataAddress({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message, signature: sig })
    expect(rec).toBe(acct.address)
  })
})

describe('mainnet signing is blocked', () => {
  it('signL1Action rejects mainnet', async () => {
    await expect(signL1Action(acct, { type: 'order', orders: [], grouping: 'na' }, 1, 'mainnet')).rejects.toBeInstanceOf(MainnetSigningBlockedError)
  })
  it('approveAgentTypedData rejects mainnet', () => {
    expect(() => approveAgentTypedData('0x5e9ee1089755c3435139848e47e6635505d5a13a', 'x', 1, 'mainnet')).toThrow(MainnetSigningBlockedError)
  })
  it('exchange client cannot be constructed for mainnet', () => {
    expect(() => new TestnetExchangeClient(acct, { next: () => 1 }, { env: 'mainnet' })).toThrow(MainnetSigningBlockedError)
  })
  it('exchange client refuses a mainnet base URL even when env says testnet', () => {
    expect(() => new TestnetExchangeClient(acct, { next: () => 1 }, { env: 'testnet', baseUrl: 'https://api.hyperliquid.xyz' })).toThrow(/mainnet/)
  })
  it('arbitrary env strings are rejected', async () => {
    await expect(signL1Action(acct, {}, 1, 'Testnet' as any)).rejects.toBeInstanceOf(MainnetSigningBlockedError)
  })
})
