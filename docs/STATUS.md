# STATUS — STRIKE G2

_Last updated: 28 Nov 2026, 12:50 IST (07:20 UTC) · branch `feat/strike-core` → PR #1_

**LIVE:** companion https://strike-g2.vercel.app · API https://strike-g2-api.onrender.com (free tiers; docs/DEPLOY.md). Submission summary: [SUBMISSION.md](../SUBMISSION.md).

Legend: **written** (code exists) · **tested** (automated tests) · **simulated** (official G2 simulator) · **testnet-verified** (Hyperliquid testnet response) · **live** (verified against the deployed URLs) · **BLOCKED** (needs owner).

## Completed

| Area | State |
|---|---|
| Research (docs/RESEARCH.md) | written |
| Hyperliquid client: info (429 retry), WS multiplexer, precision, meta, signing (python-SDK vectors), testnet-only exchange | tested · signing **testnet-verified** (testnet recovered our signer address) |
| Mainnet L2 books via one shared Hyperliquid WS feed (REST fallback) | tested (fake WS) · live (`/v1/diagnostics → bookFeed`) |
| CoinGecko budgeted client (Demo key), cache, breaker, attribution | tested · **live Demo-key suite passes** (`evidence/deployment/coingecko-demo-live.json`) |
| Asset registry (30 verified mappings) | tested · live-verified vs CoinGecko (TON listed as "Gram (prev. Toncoin)", same id) |
| Market intelligence: Radar, DNA, Liquidity Lens, Funding Clock | tested · simulated · live |
| Visual engine (4-bit frames, 7 instruments, tiling, ImageQueue) | tested · simulated |
| Shadow Trade, Risk engine, Trading core (single-use confirm, lifecycle, simulated ledger) | tested · simulated · live (simulated fills) |
| Protection, Sentinel, Replay | tested · simulated (Sentinel) |
| **Voice**: grammar + G2 PCM → optional server STT; **free browser Web Speech API** (companion + glasses phone panel); typed fallback; never confirms | tested (unit, API, controller, Playwright with mocked recognizer) · live page. Even app WebView support for Web Speech: **not verified** (no hardware) |
| Accounts: guest (A), watch-only (B), wallet ownership (C), testnet agent (D) | tested (API) · **wallet connect e2e with mocked EIP-1193 provider** (fixture + live prod) · Mode D e2e on fixture only (disabled in public deploy by design) |
| Testnet key loader (env or mode-600 file; JSON/hex) | tested · verified locally to resolve the dedicated wallet `0x5C20…23Be` (key never printed) |
| **Persistence**: optional Postgres write-through over the Prisma schema (`DATABASE_URL`), in-memory fallback | tested against **real Postgres 17** (box) and `postgres:17` (CI); not provisioned in prod (free/in-memory by decision) |
| API (Fastify): 44 routes incl. `/health` | tested · live smoke |
| Glasses app (Even Hub SDK 0.0.16) | tested (7 controller↔API tests) · **simulated** (32 steps) · `.ehpk` built against the Render API |
| Companion (Next.js 15): 13 routes | e2e tested (13 Playwright on fixture; 12 + 1 skipped on prod) · live |
| Keep-alive: `.github/workflows/keepalive.yml` (every 10 min) + cron-job.org backup documented | written · `/health` live; schedule only runs from `main` (after merge) |
| Lint: ESLint 9 + typescript-eslint + react-hooks | clean · in CI |
| CI: typecheck, lint, Prisma validate + migrate (Postgres service), Vitest, .ehpk, secret scan, Playwright | green on `e24a54e` |

## Tests run (28 Nov 2026, exact results)

| Command | Where | Result |
|---|---|---|
| `pnpm typecheck` | box | pass |
| `pnpm lint` | box + CI | pass, 0 problems |
| `pnpm test` with `STRIKE_TEST_DATABASE_URL` (local Postgres 17) + CoinGecko key in env | box | **267 / 267 passed**, 27 files |
| `pnpm test` (Postgres service, no CoinGecko key) | CI `e24a54e` | **259 passed, 8 skipped** (key-gated CoinGecko live suite) |
| `pnpm prisma:validate` · `pnpm db:deploy` | box + CI | valid · migration `0001_init` applied |
| `pnpm e2e` (Playwright, Chrome, fixture API) | box + CI | **13 / 13 passed** |
| `pnpm sim` (official evenhub-simulator 0.9.5, live API) | box, 12:35 IST | ok — **32 screenshots, 0 image failures, 1 console error** (expected 401 from a stale token in simulator localStorage; app recovered with a fresh guest) |
| `pnpm pack:g2` (`VITE_STRIKE_API`=Render) | box | `strike-g2.ehpk` 56 210 bytes, sha256 `bf49152b…3e8a` |
| `node scripts/smoke-prod.mjs` (live) | after redeploy, ~12:45 IST | **36 / 36 passed** (`evidence/deployment/api-smoke.json`) |
| Playwright vs prod (`playwright.prod.config.ts`) | after redeploy | **12 passed, 1 skipped** (Mode D: no signer in public deploy) |
| `pnpm testnet:probe` | 25 Nov (throwaway key) | signature recovered by testnet; order rejected (unfunded) → **BLOCKED** |

Earlier local e2e attempt today: 10/13 (3 failures from the fixture API's 5/min guest limit once 13 tests shared one IP) → fixture limit made configurable → 13/13. First CI run on `7681185` failed for the same reason; fixed in `34233e4`/`e24a54e` (also fixed a real UI bug: stale wallet identity after a failed refresh).

## Architecture decisions
- One renderer for glasses + companion; 576×144 instruments split into two 288×144 image containers; no page rebuilds.
- In-memory Store is the hot path; Postgres is optional write-through (hydrate on boot, flush every 1.5 s + SIGTERM).
- Guest execution = simulated ledger against the **live** book; signed execution = Hyperliquid testnet only (mainnet blocked in code).
- All voice paths feed one deterministic grammar; voice can never confirm.

## Known bugs / limitations
- Public deploy runs in-memory (no DB provisioned): restart/sleep clears guests, receipts, devices.
- Guest liquidation prices are a simulated approximation (labelled). Shadow Trade does not estimate post-trade liquidation (stated in UI).
- Radar "OI change"/"liquidity change" need observed history; empty right after start (by design).
- G2 footer is 3 × ~54 chars; long explanations are cut with `>`.
- Prod: occasional Hyperliquid REST 429 from Render's shared IP (books via WS; other reads retry once, then labelled stale; previews fail closed).
- Prod: Render auto-deploy not wired (manual `render deploys create`); keep-alive schedule needs `main`.
- Browser speech in the Even app WebView unverified; native Chrome speech denies mic in headless test browsers (handled with a readable error → typed fallback).

## Outstanding / BLOCKED (owner)
1. **Testnet trading** — dedicated wallet `0x5C2032945E13dA8B0B72031Dd2824Daa073a23Be` ready (key loads at runtime, mode 600, never committed). Needs a **mainnet deposit** from that address so the Hyperliquid testnet faucet can be claimed; then `pnpm testnet:probe` / testnet trades. No testnet order IDs exist yet.
2. **Even Hub upload** — `evenhub upload apps/glasses/strike-g2.ehpk` needs your Even Hub account.
3. **Real G2 hardware** check (BLE latency, brightness, mic, WebView speech).
4. **Server STT provider** — optional; not chosen (no paid STT). Browser speech + typed work today.
5. **Keep-alive backup** — create the free cron-job.org job (needs your account); **Render auto-deploy** — install the Render GitHub app or a deploy hook.
6. Optional: a free Postgres (Neon/Supabase) if you want state to survive restarts — not provisioned.

## Deploy state
Redeployed 28 Nov 2026 ~12:45 IST: Render `dep-dc57ssgu01pc73foshh0` (commit `e24a54e`), Vercel `dpl_CTHmpJXn2XiSigoVEzNetCns8bik` → https://strike-g2.vercel.app. See docs/DEPLOY.md.
