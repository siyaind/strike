# STATUS — STRIKE G2

_Last updated: 25 Nov 2026, 11:45 IST · branch `feat/strike-core`_

Legend: **written** (code exists) · **tested** (automated tests) · **simulated** (official G2 simulator) · **testnet-verified** (Hyperliquid testnet response) · **BLOCKED** (needs owner).

## Completed

| Area | State |
|---|---|
| Research (docs/RESEARCH.md) | written |
| Hyperliquid client: info, WS multiplexer, precision, meta, signing (python-SDK vectors), testnet-only exchange | tested · signing **testnet-verified** (testnet recovered our signer address) |
| CoinGecko budgeted client (Demo key or keyless), cache, breaker, attribution | tested (mocked); live keyless trending observed in dev |
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
| CI workflow, deploy configs (Render, Vercel), STT compose | written (CI will run on PR) |

## Tests run (this commit)

| Command | Result |
|---|---|
| `pnpm typecheck` | pass (packages + api + glasses + companion) |
| `pnpm test` (Vitest) | **244 / 244 passed**, 22 files |
| `pnpm e2e` (Playwright, Chrome, fixture API) | **8 / 8 passed** |
| `pnpm prisma:validate` | valid |
| `pnpm pack:g2` | `strike-g2.ehpk` 55 246 bytes, sha256 in `evidence/g2-package/` |
| `pnpm sim` (official simulator) | ok, 34 screenshots, 0 console errors, 0 image failures |
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

## Outstanding / BLOCKED (owner)
1. **CoinGecko Demo key** — create a free Demo key and set `COINGECKO_DEMO_API_KEY` (keyless mode works with low limits; key-gated tests not run).
2. **Testnet funds** — faucet needs a mainnet deposit from the same address; until then no testnet order ids exist.
3. **Deploy approval** — Render (API) + Vercel (companion) + Even Hub upload; configs ready.
4. **STT provider** — self-hosted faster-whisper (compose provided) or another OpenAI-compatible endpoint.
5. Real G2 hardware check (BLE latency, brightness).

## Deploy readiness
Ready to deploy once secrets are set (see docs/DEPLOY.md). Not deployed.
