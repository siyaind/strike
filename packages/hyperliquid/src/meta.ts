import type { PerpAssetMeta, SpotMeta } from './types'

export interface ResolvedInstrument {
  kind: 'perp' | 'spot'
  /** Asset id used in exchange actions: perp index, or 10000 + spot pair index. */
  assetId: number
  /** Coin string used by info/ws endpoints: perp name, or "@{index}" / "PURR/USDC" for spot. */
  coin: string
  display: string
  szDecimals: number
  maxLeverage: number | null
  env: 'mainnet' | 'testnet'
}

export class AssetResolutionError extends Error {}

/** Resolve instruments from LIVE metadata. Never hardcode asset ids — they differ between mainnet and testnet. */
export class MetaIndex {
  private perps = new Map<string, ResolvedInstrument>()
  private spots = new Map<string, ResolvedInstrument>()
  constructor(readonly env: 'mainnet' | 'testnet', perpUniverse: PerpAssetMeta[], spot?: SpotMeta) {
    perpUniverse.forEach((a, i) => {
      if (a.isDelisted) return
      this.perps.set(a.name.toUpperCase(), { kind: 'perp', assetId: i, coin: a.name, display: `${a.name}-PERP`, szDecimals: a.szDecimals, maxLeverage: a.maxLeverage, env })
    })
    if (spot) {
      for (const pair of spot.universe) {
        const base = spot.tokens[pair.tokens[0]]
        const quote = spot.tokens[pair.tokens[1]]
        if (!base || !quote) continue
        const display = `${base.name}/${quote.name}`
        const coin = pair.name.includes('/') ? pair.name : `@${pair.index}`
        this.spots.set(display.toUpperCase(), { kind: 'spot', assetId: 10000 + pair.index, coin, display, szDecimals: base.szDecimals, maxLeverage: null, env })
      }
    }
  }
  perp(name: string): ResolvedInstrument {
    const r = this.perps.get(name.toUpperCase())
    if (!r) throw new AssetResolutionError(`Unknown or delisted perp '${name}' on ${this.env}`)
    return r
  }
  spot(display: string): ResolvedInstrument {
    const r = this.spots.get(display.toUpperCase())
    if (!r) throw new AssetResolutionError(`Unknown spot pair '${display}' on ${this.env}`)
    return r
  }
  hasPerp(name: string) { return this.perps.has(name.toUpperCase()) }
  perpNames() { return [...this.perps.keys()] }
  spotPairs() { return [...this.spots.values()] }
}
