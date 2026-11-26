# STATUS — STRIKE G2

_Last updated: 26 Nov 2026, 11:55 IST · branch `feat/strike-core`_

**LIVE:** companion https://strike-g2.vercel.app · API https://strike-g2-api.onrender.com (free tiers; details in docs/DEPLOY.md).

Legend: **written** (code exists) · **tested** (automated tests) · **simulated** (official G2 simulator) · **testnet-verified** (Hyperliquid testnet response) · **BLOCKED** (needs owner).

## Completed

| Area | State |
|---|---|
| Research (docs/RESEARCH.md) | written |
| Hyperliquid client: info, WS multiplexer, precision, meta, signing (python-SDK vectors), testnet-only exchange | tested · signing **testnet-verified** (testnet recovered our signer address) |
| CoinGecko budgeted client (Demo key or keyless), cache, breaker, attribution | tested (mocked) · **live Demo-key tests pass** (evidence/deployment/coingecko-demo-live.json) |
| Asset registry (30 verified mappings, collisions) | tested |
| Market intelligence: Radar, Market DNA, Liquidity Lens, Funding Clock | tested · simulated |
| Visual engine: 4-bit frames, 7 instruments, PNG, tiling, ImageQueue | tested · simulated |
| Shadow Trade, Risk engine, Trading core (proposal, single-use confirm, lifecycle, simulated ledger) | tested · simulated |
| Protection (verified from orders), Sentinel, Replay, Voice grammar + PCM utils | tested · simulated (Sentinel) |
| Wallet auth (Mode C), agent keystore + nonces (Mode D), watch-only (Mode B), guest (Mode A) | tested (API) |
| API (Fastify): 40+ routes | tested — 28 integration tests on recorded real fixtures |
| Glasses app (Even Hub SDK 0.0.16): 14 screens, fixed layout, serial image pipeline | tested (6 controller↔API tests) · **simulated** (34 steps, 0 errors) · `.ehpk` packed |
| Companion (Next.js 15): 13 routes, obsidian/acid-lime design, same frames as glasses | built · e2e tested (Playwright 8/8) |
| Prisma schema | validated (`prisma validate`) |
| CI workflow, deploy configs (Render, Vercel), STT compose | CI green on PR #1 · **deployed** (Vercel + Render free) · STT not run |
| Mainnet L2 books via shared Hyperliquid WS feed (REST fallback) | tested (fake WS) · verified live on Render (`/v1/diagnostics` → `bookFeed.wsHits`) |

## Tests run (this commit)

| Command | Result |
|---|---|
| `pnpm typecheck` | pass (packages + api + glasses + companion) |
| `pnpm test` (Vitest) | **256 / 256 passed**, 24 files (incl. key-gated CoinGecko live suite) |
| `pnpm e2e` (Playwright, Chrome, fixture API) | **8 / 8 passed** |
| `pnpm prisma:validate` | valid |
| `pnpm pack:g2` | `strike-g2.ehpk` 55 246 bytes, sha256 in `evidence/g2-package/` |
| `pnpm sim` (official simulator) | ok, 34 screenshots, 0 console errors, 0 image failures |
| `node scripts/smoke-prod.mjs` (live URLs) | **34 / 34** |
| Playwright vs prod companion | **8 / 8** (one earlier run 7/8: radar test hit a moment of stale HL data → rerun 8/8; both recorded honestly here) |
| `pnpm testnet:probe` | signature accepted/recovered; order rejected: account does not exist (unfunded) → BLOCKED |

## Architecture decisions
- One renderer for glasses + companion; instruments 576×144 split into two 288×144 image containers.
- No page rebuilds after startup (flicker-free; only content updates).
- In-memory store for the hackathon; Prisma schema ready for Postgres.
- Guest execution = simulated ledger filling against the **live** public book; signed execution = Hyperliquid testnet only.

## Known bugs / limitations
- State is in-memory: restart clears guests, receipts, devices.
- Guest liquidation prices are a simulated approximation (labelled `simulated-approximation`).
- Shadow Trade does not estimate post-trade liquidation (explicitly stated in the UI).
- Radar "OI change" and "liquidity change" categories need observed history; empty right after start (by design — no invented history).
- Footer text on G2 is truncated to 3 × ~54 chars; some explanations are cut with `>`.
- The companion wallet flow (EIP-1193) was not exercised in e2e (no browser wallet in CI).
- Prod: Hyperliquid REST occasionally returns 429 from Render's shared IP; books come from WS, other reads retry once then serve labelled stale data.
- Prod: Render free instance sleeps when idle (cold start ~30–60 s, in-memory state lost); auto-deploy not wired (manual `render deploys create`).

## Outstanding / BLOCKED (owner)
1. **Testnet funds** — faucet needs a mainnet deposit from the same address; until then no testnet order ids exist. Public deploy has **no signing key** (Mode D disabled by design).
2. **STT provider** — not chosen; typed fallback live; set `STRIKE_STT_URL` (self-hosted faster-whisper compose provided). No paid STT.
3. **Even Hub upload** — rebuilt `.ehpk` points at the Render API; `evenhub upload` needs your Even Hub account.
4. **Render auto-deploy** — install the Render GitHub app or add a deploy hook (currently manual).
5. Real G2 hardware check (BLE latency, brightness).

## Deploy state
Deployed 26 Nov 2026 (owner-approved). See docs/DEPLOY.md.
