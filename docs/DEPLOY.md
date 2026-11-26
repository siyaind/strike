# Deployment (LIVE — owner-approved 26 Nov 2026)

_Last updated: 26 Nov 2026, 11:55 IST (06:25 UTC)_

| Piece | Live URL / target | State |
|---|---|---|
| Companion | **https://strike-g2.vercel.app** — Vercel project `strike-g2`, root `apps/companion`, Next.js, Node 22 | Live. Vercel SSO/Deployment Protection **disabled** (public). `NEXT_PUBLIC_STRIKE_API=https://strike-g2-api.onrender.com` baked into the build. |
| API | **https://strike-g2-api.onrender.com** — Render free web service `srv-dc3sjqmq1p3s73c75q50` (Singapore), branch `feat/strike-core` | Live on free plan. In-memory store (no Postgres). Health check `/healthz`. |
| Glasses | Even Hub | `app.json` network whitelist now `http://localhost:8899` + `https://strike-g2-api.onrender.com`; `.ehpk` rebuilt with `VITE_STRIKE_API` = Render URL (sha256 in `evidence/g2-package/`). **Not uploaded** — `evenhub upload` needs the owner's Even Hub account. |
| STT | — | Not configured. Typed fallback active; provider is configurable via `STRIKE_STT_URL` (OpenAI-compatible). No paid STT. |
| Database | — | Not provisioned (free/in-memory by decision). State resets on restart/sleep. |

## Render environment (values never printed or committed)
- `NODE_VERSION=22`
- `STRIKE_PUBLIC_ORIGIN` = `STRIKE_ALLOWED_ORIGINS` = `https://strike-g2.vercel.app` → **strict CORS** (other origins get no ACAO header; verified in smoke).
- `STRIKE_CONFIRM_SECRET` — random, generated on the box.
- `COINGECKO_DEMO_API_KEY` — owner's free Demo key, set from the box environment.
- **No `STRIKE_SIGNER_KEK` and no testnet key** → agent signer disabled (`/v1/diagnostics` → `signer.configured: false`; agent endpoints return 403). Public deploy = guest (simulated ledger on live books), watch-only, wallet-auth only. Mainnet signing is blocked in code regardless.

Build: `npx -y pnpm@9.15.4 install --frozen-lockfile --filter "@strike/api..."` · Start: `cd apps/api && node_modules/.bin/tsx src/main.ts`.

## Redeploying
- **Render auto-deploy does not fire** (public repo connected without the Render GitHub app). Deploy manually:
  `render deploys create srv-dc3sjqmq1p3s73c75q50 --commit <sha> --wait --confirm`
  (or install the Render GitHub app / add a deploy hook — owner action).
- Vercel: `vercel deploy --prod` from the repo root (project linked; `.vercelignore` excludes evidence/docs).

## Verification (evidence in `evidence/deployment/`)
| Check | Result |
|---|---|
| `node scripts/smoke-prod.mjs` (health, readiness, guest flow, live radar, DNA/lens/funding/orbit/shadow, preview→confirm→receipt, replay/cross-user refusal, voice confirm refusal, 401/403, CORS, diagnostics, 13 companion routes, security headers) | **34/34** (`api-smoke.json`) |
| Playwright vs prod companion (`playwright.prod.config.ts`, 8 tests) | **8/8** (`playwright-prod-results.json`, `screens/`) |
| CoinGecko Demo live tests (`tests/live/coingecko-demo.live.test.ts`, key-gated) | **pass** — ping, trending, cache, 30/30 verified mappings (TON listed as "Gram (prev. Toncoin)", same id), global, categories, coin, search, 7-day chart, attribution (`coingecko-demo-live.json`; key not in file) |

## Known operational limits
- **Hyperliquid REST 429 on Render's shared egress IP.** Mitigations shipped: one jittered retry on info reads; mainnet L2 books served from a shared Hyperliquid **WebSocket** feed (REST fallback); stale data is labelled `STALE PUBLIC MARKET DATA` with its age, and previews fail closed on stale books. Occasional 429s on `metaAndAssetCtxs` still occur (seen in `/v1/diagnostics`).
- Free Render instances sleep after ~15 min idle; first request takes ~30–60 s and in-memory state is lost.
- Guest creation is limited to 5/min per IP.

Free tiers only; no paid services were used or configured.
