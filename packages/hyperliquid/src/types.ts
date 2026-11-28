export interface PerpAssetMeta { name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: boolean; isDelisted?: boolean; marginTableId?: number }
export interface PerpAssetCtx {
  funding: string; openInterest: string; prevDayPx: string; dayNtlVlm: string; premium: string | null
  oraclePx: string; markPx: string; midPx: string | null; impactPxs: string[] | null; dayBaseVlm: string
}
export interface SpotToken { name: string; szDecimals: number; weiDecimals: number; index: number; tokenId: string; isCanonical: boolean }
export interface SpotPair { name: string; tokens: [number, number]; index: number; isCanonical: boolean }
export interface SpotMeta { universe: SpotPair[]; tokens: SpotToken[] }
export interface L2Level { px: string; sz: string; n: number }
export interface L2Book { coin: string; time: number; levels: [L2Level[], L2Level[]] }
export interface Candle { t: number; T: number; s: string; i: string; o: string; c: string; h: string; l: string; v: string; n: number }
export interface FundingHistoryRow { coin: string; fundingRate: string; premium: string; time: number }
export interface AssetPosition {
  type: 'oneWay'
  position: {
    coin: string; szi: string; entryPx: string | null; positionValue: string; unrealizedPnl: string; returnOnEquity: string
    liquidationPx: string | null; marginUsed: string; maxLeverage: number
    leverage: { type: 'cross' | 'isolated'; value: number; rawUsd?: string }
    cumFunding: { allTime: string; sinceOpen: string; sinceChange: string }
  }
}
export interface ClearinghouseState {
  assetPositions: AssetPosition[]
  marginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string }
  crossMarginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string }
  crossMaintenanceMarginUsed: string
  withdrawable: string
  time: number
}
export interface FrontendOpenOrder {
  coin: string; side: 'A' | 'B'; limitPx: string; sz: string; oid: number; timestamp: number; origSz: string
  triggerCondition: string; isTrigger: boolean; triggerPx: string; isPositionTpsl: boolean; reduceOnly: boolean; orderType: string; tif: string | null; cloid: string | null
}
export interface UserFill {
  coin: string; px: string; sz: string; side: 'A' | 'B'; time: number; startPosition: string; dir: string
  closedPnl: string; hash: string; oid: number; crossed: boolean; fee: string; tid: number; feeToken: string
}
export interface UserFunding { time: number; hash: string; delta: { type: 'funding'; coin: string; usdc: string; szi: string; fundingRate: string } }
export type CandleInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M'
export const CANDLE_INTERVALS: CandleInterval[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M']
export const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3,
  '8h': 28800e3, '12h': 43200e3, '1d': 86400e3, '3d': 259200e3, '1w': 604800e3, '1M': 2592000e3,
}
/** Hyperliquid funding is paid every hour (docs: trading/funding — "The funding interval is 1 hour"). */
export const FUNDING_INTERVAL_MS = 3600e3
