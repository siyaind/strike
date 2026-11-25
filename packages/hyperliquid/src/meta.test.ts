import { describe, expect, it } from 'vitest'
import { MetaIndex, AssetResolutionError } from './meta'

const mainU = [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'ETH', szDecimals: 4, maxLeverage: 25 }, { name: 'MATIC', szDecimals: 1, maxLeverage: 20, isDelisted: true }, { name: 'SOL', szDecimals: 2, maxLeverage: 20 }]
const testU = [{ name: 'SOL', szDecimals: 2, maxLeverage: 10 }, { name: 'APT', szDecimals: 2, maxLeverage: 3 }, { name: 'BTC', szDecimals: 5, maxLeverage: 40 }]
const spot = { tokens: [{ name: 'USDC', szDecimals: 8, weiDecimals: 8, index: 0, tokenId: '0x1', isCanonical: true }, { name: 'PURR', szDecimals: 0, weiDecimals: 5, index: 1, tokenId: '0x2', isCanonical: true }, { name: 'HYPE', szDecimals: 2, weiDecimals: 8, index: 150, tokenId: '0x3', isCanonical: false }], universe: [{ name: 'PURR/USDC', tokens: [1, 0] as [number, number], index: 0, isCanonical: true }, { name: '@107', tokens: [2, 0] as [number, number], index: 107, isCanonical: false }] }

describe('asset resolution from live metadata', () => {
  it('perp ids differ between mainnet and testnet', () => {
    expect(new MetaIndex('mainnet', mainU).perp('SOL').assetId).toBe(3)
    expect(new MetaIndex('testnet', testU).perp('SOL').assetId).toBe(0)
    expect(new MetaIndex('testnet', testU).perp('btc').assetId).toBe(2)
  })
  it('delisted perps are not resolvable', () => { expect(() => new MetaIndex('mainnet', mainU).perp('MATIC')).toThrow(AssetResolutionError) })
  it('spot asset id = 10000 + pair index; non-canonical uses @index coin', () => {
    const m = new MetaIndex('mainnet', mainU, spot)
    expect(m.spot('PURR/USDC')).toMatchObject({ assetId: 10000, coin: 'PURR/USDC' })
    expect(m.spot('HYPE/USDC')).toMatchObject({ assetId: 10107, coin: '@107', szDecimals: 2 })
  })
  it('unknown perp throws', () => { expect(() => new MetaIndex('mainnet', mainU).perp('NOPE')).toThrow() })
})
