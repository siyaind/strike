# STRIKE G2

**See the market. Understand the risk. Make your move — heads up.**

STRIKE turns Hyperliquid into glanceable instruments on Even Realities G2 glasses: **Market Radar, Market DNA, Liquidity Lens, Position Orbit, Shadow Trade, Funding Clock, Sentinel and Replay**, with a Next.js companion that renders the exact same 4-bit frames. Built for Even Realities × TVM *Heads Up* (Crypto & DeFi).

> Safety: guest mode is simulated; signed actions are **Hyperliquid testnet only** (mainnet blocked in code and tested). No withdrawals, transfers, bridging or automated trading exist in the codebase. Voice can never confirm an order.

## Quick start
```bash
pnpm install
pnpm dev:api          # :8899 — live public Hyperliquid data
pnpm dev:glasses      # :5180 — Even Hub app (open in evenhub-simulator)
pnpm dev:companion    # :3100
```
Simulator: `evenhub-simulator http://localhost:5180 --automation-port 9898`, then `pnpm sim`.

## Tests
`pnpm typecheck` · `pnpm test` (244 Vitest) · `pnpm e2e` (8 Playwright) · `pnpm prisma:validate` · `pnpm pack:g2` · `pnpm sim`

## Layout
`apps/glasses` (Even Hub SDK 0.0.16) · `apps/companion` (Next.js 15) · `apps/api` (Fastify 5) · `packages/*` (hyperliquid, coingecko, asset-registry, market-intelligence, visual-engine, shadow-trade, risk-engine, trading-core, protection, sentinel, replay, voice-engine, wallet-auth, signer, security, shared) · `prisma/` · `services/stt` · `docs/` · `evidence/`

Docs: [STATUS](docs/STATUS.md) · [RESEARCH](docs/RESEARCH.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [SIMULATOR](docs/SIMULATOR.md) · [TESTNET](docs/TESTNET.md) · [DEPLOY](docs/DEPLOY.md) · [DEMO-SCRIPT](docs/DEMO-SCRIPT.md) · [REUSED-CODE-DISCLOSURE](docs/REUSED-CODE-DISCLOSURE.md)

Market data from Hyperliquid's public API. Trending data **Powered by [CoinGecko](https://www.coingecko.com/en/api)**.
