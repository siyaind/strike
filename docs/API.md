# API reference (apps/api, Fastify 5)

Base: `https://strike-g2-api.onrender.com` (prod) · `http://localhost:8899` (dev). Auth: `Authorization: Bearer <token>` from a guest, wallet or watch session (or a paired device). CORS: only the companion origin. All bodies are zod-validated; errors are `{ error: CODE, message }`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health`, `GET /healthz` | – | Liveness, no upstream calls (keep-alive + Render health check) |
| `GET /readyz` | – | Readiness: Hyperliquid mainnet meta reachable |
| `POST /v1/guest/session` | – | Mode A guest (simulated ledger, 2 h TTL; 5/min per IP) |
| `GET /v1/me` · `POST /v1/auth/logout` | ✓ | Session info · revoke all sessions |
| `POST /v1/auth/challenge` · `POST /v1/auth/verify` | – | Mode C wallet ownership (SIWE-style `personal_sign`, origin-bound, single use) |
| `POST /v1/accounts/watch` | – | Mode B watch-only (rejects agent addresses) |
| `POST /v1/signers/agent` · `POST /v1/signers/agent/approve` | wallet | Mode D testnet agent (EIP-712 approveAgent, Testnet); disabled without `STRIKE_SIGNER_KEK` |
| `POST /v1/pairing/start` · `POST /v1/pairing/claim` · `GET /v1/devices` · `DELETE /v1/devices/:id` | ✓ / – | G2 pairing (6-digit, 5 min, single use) and revocation |
| `GET /v1/markets` · `/v1/markets/:coin` · `/book` · `/candles` | – | Live Hyperliquid market data with ages |
| `GET /v1/radar` | opt. | Market Radar (categories, explanations, CoinGecko trending) |
| `GET /v1/market-dna/:coin` · `/v1/liquidity-lens/:coin` · `/v1/funding/:coin` | – | Instruments |
| `GET /v1/portfolio` · `GET /v1/positions/:coin/orbit` | ✓ | Positions (simulated for guests; real read-only for watch/wallet) |
| `POST /v1/shadow-trade` · `POST /v1/risk/scenarios` · `GET/PUT /v1/risk/policy` | ✓ | What-if and risk limits |
| `POST /v1/trade/preview` · `POST /v1/trade/confirm` · `POST /v1/trade/cancel-preview` | ✓ | Preview → single-use 30 s confirm (simulated for guests; testnet for Mode D) |
| `GET /v1/receipts` · `POST /v1/receipts/:id/reconcile` · `GET /v1/orders` | ✓ | Receipts and reconciliation |
| `GET /v1/protection/status` · `POST /v1/protection/stop` | ✓ | Stop placement verified from orders |
| `GET /v1/sentinel/events` | ✓ | Alerts only (no automation) |
| `GET /v1/replay/market` · `GET /v1/replay/position` | ✓ | Replay |
| `POST /v1/voice/command` | ✓ | Parse text (`source`: typed · browser-stt · stt) → intent; confirm always refused |
| `POST /v1/voice/transcribe` · `GET /v1/voice/history` | ✓ | Optional server STT (`STRIKE_STT_URL`) · history |
| `GET /v1/diagnostics` | – | Upstream health, CoinGecko budget, WS feed, persistence mode, STT, signer configured (no secrets) |
