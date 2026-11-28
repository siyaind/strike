/** Every data point STRIKE displays carries its provenance. */
export interface Sourced<T> {
  value: T
  source: 'hyperliquid-mainnet' | 'hyperliquid-testnet' | 'coingecko' | 'strike-derived' | 'simulated'
  ts: number
}

export type DataLabel = 'LIVE PUBLIC MARKET DATA' | 'SIMULATED ACCOUNT' | 'SIMULATED EXECUTION' | 'TESTNET EXECUTION' | 'WATCH-ONLY'

export type Side = 'long' | 'short'

export interface PositionView {
  id: string
  coin: string
  side: Side
  size: string // absolute base units
  entryPx: string
  markPx: string | null
  liquidationPx: string | null
  leverage: number
  marginMode: 'cross' | 'isolated'
  unrealizedPnl: string | null
  stopPx: string | null
  takeProfitPx: string | null
  label: DataLabel
  ts: number
}
