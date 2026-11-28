/** Hyperliquid environments. Signed execution is permitted ONLY on testnet. */
export type HlEnv = 'mainnet' | 'testnet'

export const HL_ENDPOINTS: Record<HlEnv, { rest: string; ws: string }> = {
  mainnet: { rest: 'https://api.hyperliquid.xyz', ws: 'wss://api.hyperliquid.xyz/ws' },
  testnet: { rest: 'https://api.hyperliquid-testnet.xyz', ws: 'wss://api.hyperliquid-testnet.xyz/ws' },
}

export class MainnetSigningBlockedError extends Error {
  readonly code = 'MAINNET_SIGNING_BLOCKED'
  constructor(where: string) {
    super(`Mainnet signed execution is disabled in STRIKE (attempted in ${where}).`)
  }
}

/** Hard guard. Call before any signing or /exchange POST. */
export function assertSigningAllowed(env: string, where: string): asserts env is 'testnet' {
  if (env !== 'testnet') throw new MainnetSigningBlockedError(where)
}
