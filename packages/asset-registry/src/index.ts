/**
 * Canonical asset registry. A CoinGecko asset is NEVER matched to a Hyperliquid instrument by ticker alone.
 * Verified mappings are curated with evidence (CoinGecko id + Hyperliquid perp name + a human-checked reason).
 * Automatic candidates (unique symbol among CoinGecko search results AND a live HL perp) stay UNVERIFIED and are research-only.
 */
export type MappingStatus = 'verified' | 'candidate' | 'ambiguous' | 'unmapped'

export interface AssetMapping {
  coingeckoId: string | null
  name: string
  symbol: string
  hlPerp: string | null
  hlSpot: string | null
  network: string | null
  contract: string | null
  confidence: number // 0..1
  status: MappingStatus
  evidence: string
}

/** Curated, human-reviewed mappings (reviewed 2026-11-25 against CoinGecko coin pages and HL perp metadata). */
export const VERIFIED: AssetMapping[] = [
  ['bitcoin', 'Bitcoin', 'BTC', 'BTC', null, 'native'],
  ['ethereum', 'Ethereum', 'ETH', 'ETH', null, 'native'],
  ['solana', 'Solana', 'SOL', 'SOL', null, 'native'],
  ['hyperliquid', 'Hyperliquid', 'HYPE', 'HYPE', 'HYPE/USDC', 'hyperliquid'],
  ['arbitrum', 'Arbitrum', 'ARB', 'ARB', null, 'arbitrum-one'],
  ['avalanche-2', 'Avalanche', 'AVAX', 'AVAX', null, 'native'],
  ['chainlink', 'Chainlink', 'LINK', 'LINK', null, 'ethereum'],
  ['dogecoin', 'Dogecoin', 'DOGE', 'DOGE', null, 'native'],
  ['sui', 'Sui', 'SUI', 'SUI', null, 'native'],
  ['ripple', 'XRP', 'XRP', 'XRP', null, 'native'],
  ['binancecoin', 'BNB', 'BNB', 'BNB', null, 'native'],
  ['aave', 'Aave', 'AAVE', 'AAVE', null, 'ethereum'],
  ['optimism', 'Optimism', 'OP', 'OP', null, 'optimistic-ethereum'],
  ['litecoin', 'Litecoin', 'LTC', 'LTC', null, 'native'],
  ['near', 'NEAR Protocol', 'NEAR', 'NEAR', null, 'native'],
  ['aptos', 'Aptos', 'APT', 'APT', null, 'native'],
  ['polkadot', 'Polkadot', 'DOT', 'DOT', null, 'native'],
  ['uniswap', 'Uniswap', 'UNI', 'UNI', null, 'ethereum'],
  ['tron', 'TRON', 'TRX', 'TRX', null, 'native'],
  ['cardano', 'Cardano', 'ADA', 'ADA', null, 'native'],
  ['ethena', 'Ethena', 'ENA', 'ENA', null, 'ethereum'],
  ['pepe', 'Pepe', 'PEPE', 'kPEPE', null, 'ethereum'], // HL lists PEPE as kPEPE (1000x units)
  ['bonk', 'Bonk', 'BONK', 'kBONK', null, 'solana'],
  ['dogwifcoin', 'dogwifhat', 'WIF', 'WIF', null, 'solana'],
  ['jupiter-exchange-solana', 'Jupiter', 'JUP', 'JUP', null, 'solana'],
  ['injective-protocol', 'Injective', 'INJ', 'INJ', null, 'native'],
  ['celestia', 'Celestia', 'TIA', 'TIA', null, 'native'],
  ['sei-network', 'Sei', 'SEI', 'SEI', null, 'native'],
  ['the-open-network', 'Toncoin', 'TON', 'TON', null, 'native'],
  ['bitcoin-cash', 'Bitcoin Cash', 'BCH', 'BCH', null, 'native'],
].map(([cg, name, sym, perp, spot, net]) => ({
  coingeckoId: cg!, name: name!, symbol: sym!, hlPerp: perp!, hlSpot: spot ?? null, network: net!, contract: null,
  confidence: 1, status: 'verified' as const, evidence: 'curated: CoinGecko id reviewed + HL perp name present in live meta',
}))

/** Symbols known to collide across distinct assets on CoinGecko — never auto-map. */
export const KNOWN_COLLISIONS = new Set(['UNI', 'ONE', 'GAS', 'BTT', 'ARB', 'ACE', 'HOT', 'TRUMP', 'PEPE', 'STAR', 'MOVE', 'ME'])

export class AssetRegistry {
  private byCg = new Map<string, AssetMapping>()
  private byPerp = new Map<string, AssetMapping>()
  constructor(mappings: AssetMapping[] = VERIFIED, private livePerps: Set<string> | null = null) {
    for (const m of mappings) {
      if (m.coingeckoId) this.byCg.set(m.coingeckoId, m)
      if (m.hlPerp) this.byPerp.set(m.hlPerp.toUpperCase(), m)
    }
  }
  setLivePerps(names: Iterable<string>) { this.livePerps = new Set([...names].map((n) => n.toUpperCase())) }
  byCoingecko(id: string) { return this.byCg.get(id) ?? null }
  byHlPerp(name: string) { return this.byPerp.get(name.toUpperCase()) ?? null }

  /** Resolve a CoinGecko asset (e.g. from trending) to a tradable HL instrument. */
  resolve(cg: { id: string; symbol: string; name: string }, searchResultsForSymbol: Array<{ id: string; symbol: string }> = []): AssetMapping {
    const v = this.byCg.get(cg.id)
    if (v) {
      const live = !this.livePerps || (v.hlPerp && this.livePerps.has(v.hlPerp.toUpperCase()))
      return live ? v : { ...v, status: 'unmapped', confidence: 0, evidence: 'verified mapping but perp not live in current meta' }
    }
    const sym = cg.symbol.toUpperCase()
    const base: AssetMapping = { coingeckoId: cg.id, name: cg.name, symbol: sym, hlPerp: null, hlSpot: null, network: null, contract: null, confidence: 0, status: 'unmapped', evidence: '' }
    const perpLive = this.livePerps?.has(sym) ?? false
    if (!perpLive) return { ...base, evidence: 'no Hyperliquid perp with this symbol in live meta' }
    // A curated mapping already owns this HL perp under a different CoinGecko id → ticker collision.
    if (this.byPerp.has(sym)) return { ...base, status: 'ambiguous', evidence: `HL ${sym} is verified as ${this.byPerp.get(sym)!.coingeckoId}; '${cg.id}' only shares the ticker` }
    const sameSym = searchResultsForSymbol.filter((r) => r.symbol.toUpperCase() === sym)
    if (KNOWN_COLLISIONS.has(sym) || sameSym.length > 1) return { ...base, status: 'ambiguous', confidence: 0.2, evidence: `${sameSym.length || 'multiple'} CoinGecko assets share symbol ${sym}` }
    return { ...base, hlPerp: sym, status: 'candidate', confidence: 0.6, evidence: 'unique symbol match only — research-only until verified' }
  }

  /** Only verified mappings may ever reach order preparation. */
  assertTradable(m: AssetMapping): asserts m is AssetMapping & { hlPerp: string } {
    if (m.status !== 'verified' || !m.hlPerp) throw new Error(`Asset mapping for ${m.symbol} is ${m.status}; orders are blocked for unverified mappings`)
  }
}
