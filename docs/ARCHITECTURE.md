# Architecture

```
Even G2 glasses ──BLE── Even app (phone WebView)
                          └─ apps/glasses (Vite + Even Hub SDK 0.0.16)
                               Controller (pure, tested) → View{header, footer, Frame 576×144}
                               → textContainerUpgrade ×2 + ImageQueue → 2× updateImageRawData (288×144 PNG)
                                         │ HTTPS (CORS allow-list)
Browser ── apps/companion (Next.js 15) ──┤
                                         ▼
                         apps/api (Fastify 5)  ── in-memory Store ⇄ optional Postgres write-through (DATABASE_URL, Prisma schema)
                           ├─ MarketService: shared TTL cache + in-flight dedupe (HL info, CoinGecko); mainnet L2 books via one shared HL WebSocket (BookFeed)
                           ├─ market-intelligence: radar · dna · lens · funding
                           ├─ shadow-trade · risk-engine · trading-core (proposal/confirm/lifecycle, simulated ledger)
                           ├─ protection · sentinel · replay · voice-engine
                           ├─ wallet-auth (Mode C) · signer (agent keystore, nonces)
                           └─ hyperliquid: InfoClient · WS multiplexer · TestnetExchangeClient (mainnet blocked)
```

- **One renderer, two surfaces**: `@strike/visual-engine` draws 4-bit frames used by the glasses (PNG to SDK) and the companion (canvas). What you see on the phone is what the glasses show.
- **Glasses layout**: one startup page, never rebuilt. Header text 0–34, instrument 38–182 (2 image containers), footer text 186–288, event-capture text layer full-screen behind.
- **Navigation** (G2 has swipe up/down, tap, double-tap): Hub → Radar / Positions / Sentinel / Voice; per-coin instrument ring Orbit (if position) → DNA → Lens → Shadow → Funding (tap = next, swipe = adjust, double-tap = back, double-tap at hub = exit). Shadow → PREVIEW ORDER → Preview (CANCEL default) → Receipt.
- **Data honesty**: every response carries timestamps/ages; failures surface as ERROR screens or "unavailable", never as invented values. Liquidation after a shadow trade is explicitly not estimated.
- **Multi-user**: all per-user state (ledger, receipts, policy, sentinel, voice, devices) keyed by user id; market data shared through one cache (25 concurrent guests → 1 CoinGecko call, ≤ 2 HL meta calls — tested).
- **Persistence**: the in-memory Store is the hot path; with `DATABASE_URL` it is hydrated from Postgres on boot and dirty users are written through every 1.5 s and on SIGTERM (docs/PERSISTENCE.md).
- **Voice**: G2 mic PCM → optional server STT (`STRIKE_STT_URL`), or free browser Web Speech API on the companion / phone WebView, or typed — all feed the same deterministic grammar (docs/VOICE.md).
- **Ops**: `/health` liveness (no upstream calls) pinged every 10 min by `.github/workflows/keepalive.yml` to keep the Render free instance awake.
