# STRIKE G2 — Hackathon submission

**Event / track:** Even Realities × TVM *Heads Up* hackathon — **Crypto & DeFi**
**Tagline:** See the market. Understand the risk. Make your move — heads up.

## What it is
STRIKE turns Hyperliquid perpetuals into glanceable, honest instruments on **Even Realities G2** smart glasses, with a phone/desktop companion that renders the *exact same* 4-bit frames. You can read the market, understand the risk of a trade before you make it, and only then act — with execution that is simulated for guests and **Hyperliquid testnet-only** for signed actions (mainnet signing is blocked in code and tested).

## Links
| | |
|---|---|
| Companion (live) | https://strike-g2.vercel.app |
| API (live) | https://strike-g2-api.onrender.com (`/health`, `/readyz`, `/v1/diagnostics`) |
| Repository | https://github.com/siyaind/strike |
| G2 package | `apps/glasses/strike-g2.ehpk` (build: `pnpm pack:g2`; sha256 in `evidence/g2-package/`) |

## Features
- **Market Radar** — every Hyperliquid perp on one plot (24h move × volume rank × OI), with *why* each market is flagged (movers, funding stress, volume, CoinGecko trending, your positions/watchlist).
- **Market DNA** — six measured traits vs the live universe.
- **Liquidity Lens** — live order-book slippage for $100–$1k sizes (shared Hyperliquid WebSocket feed).
- **Position Orbit** — position, liquidation and stop on one rail; ±% scenarios.
- **Shadow Trade** — exposure now→after, fees, margin, funding/hour, P&L at ±2/5/10 % — nothing is sent.
- **Funding Clock**, **Sentinel** (alerts only, e.g. unprotected positions), **Replay**.
- **Safe execution** — preview (CANCEL is default) → single-use 30 s confirm → receipt; duplicate/cross-user/expired confirms refused; reconcile on unknown outcomes.
- **Voice** — G2 push-to-talk (optional server STT), free browser **Web Speech API** on companion/phone, or typed; one deterministic grammar; **voice can never confirm a trade**.
- **Accounts** — guest demo (simulated ledger on live books), watch-only, wallet ownership proof (EIP-1193 `personal_sign`), testnet agent (EIP-712, disabled in the public deploy).
- **Companion** — 13 routes incl. workspace, radar, asset, orbit, risk lab, replay, sentinel, voice studio, G2 pairing, wallet, diagnostics.
- **Ops** — strict CORS, rate limits, keep-alive, optional Postgres persistence, CI (typecheck, lint, Vitest incl. real Postgres, Playwright, .ehpk build, secret scan).

## Run it locally
```bash
pnpm install
pnpm dev:api          # :8899 — live public Hyperliquid data
pnpm dev:companion    # :3100
pnpm dev:glasses      # :5180 — Even Hub app
```

### Run the official G2 simulator
```bash
pnpm dev:api & pnpm dev:glasses &
npx evenhub-simulator http://localhost:5180 --automation-port 9898   # from apps/glasses (devDependency)
pnpm sim && pnpm sim:view    # scripted flows → evidence/g2-simulator/ (+ view/ renders)
```
Controls in the simulator: swipe up/down, tap, double-tap (back; at Home = exit). Start: tap **GUEST DEMO**.

## Demo checklist
1. **~1 minute before:** open https://strike-g2-api.onrender.com/health (wakes the free Render instance; keep-alive normally keeps it warm) and https://strike-g2.vercel.app.
2. Check https://strike-g2-api.onrender.com/v1/diagnostics → `hyperliquid.lastError` empty or old, `coingecko.circuit: closed`.
3. Companion → **Guest demo** → Workspace shows SIMULATED account with BTC/ETH/SOL.
4. Glasses/simulator: GUEST DEMO → Radar → ETH Orbit → DNA → Lens → Shadow → Preview (CANCEL default) → CONFIRM → SIMULATED receipt.
5. Voice studio: say/type "what happens if BTC falls five percent" → scenario; say "confirm the order" → refused.
6. Wallet page: connect a browser wallet → ownership proof (no transaction, no gas).
7. Script: `docs/DEMO-SCRIPT.md` (3 minutes).

## Verification evidence
`docs/STATUS.md` (every test run with exact results) · `evidence/` (unit, e2e, simulator screenshots, deployment smoke, Playwright vs prod, CoinGecko live, testnet probe).

## Honest limitations
- **Testnet trading is blocked** pending a funded wallet: Hyperliquid's testnet faucet requires the same address to have deposited on Hyperliquid **mainnet**. A dedicated wallet (`0x5C20…23Be`) is prepared and loads at runtime, but no testnet order IDs exist yet and none are claimed. Signing itself was testnet-verified (the testnet recovered our signer address).
- **Not yet tested on real G2 hardware** — verified on the official Even Hub simulator only (no IMU/BLE latency/brightness checks).
- **Even Hub upload pending** the owner's Even Hub account (`evenhub upload strike-g2.ehpk`).
- Public deploy is free-tier: in-memory state (Postgres optional, not provisioned), Render cold starts if the keep-alive misses, occasional Hyperliquid REST 429s from Render's shared IP (data is labelled stale; previews fail closed).
- Server-side STT is not configured (no paid STT); browser speech availability inside the Even app WebView is unverified.

Market data: Hyperliquid public API. Trending data **Powered by [CoinGecko](https://www.coingecko.com/en/api)**.
