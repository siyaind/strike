# STRIKE G2 — Research notes

Everything below was checked against primary sources during the build (Nov 2026). Where the build depended on a fact, the test that pins it is listed.

## 1. Even Realities G2 / Even Hub SDK

Sources: `@evenrealities/even_hub_sdk@0.0.16` type definitions (`dist/index.d.ts`), the official templates repo (`even-realities/evenhub-templates`: minimal, image, asr, text-heavy), the `everything-evenhub` skills/docs (quickstart, build-and-deploy, cli-reference, device-features), and `@evenrealities/evenhub-simulator@0.9.5` / `@evenrealities/evenhub-cli@0.2.0`.

| Fact | Consequence in STRIKE |
|---|---|
| Display 576×288, 4-bit greyscale (16 levels, rendered green). | All instruments are drawn into a 4-bit `Frame` (`packages/visual-engine`). Meaning never depends on shade alone (shapes + labels). |
| Call order: `waitForEvenAppBridge()` → `createStartUpPageContainer` **once** → `rebuildPageContainer` / `textContainerUpgrade` / `updateImageRawData`. | `apps/glasses/src/main.ts` creates one fixed page and then only updates content (no rebuild flicker). |
| Max 12 containers, ≤ 8 text, ≤ 4 image; image containers 20–288 wide × 20–144 tall; images cannot capture events; exactly one container with `isEventCapture=1`. | Layout: header text (0–34), two 288×144 image containers (y 38) holding one 576×144 instrument, footer text (186–288), full-screen event-capture text layer behind. `tile()` splits frames; `validateImageSize` enforced in tests. |
| `updateImageRawData` takes encoded image bytes (PNG) and must not overlap. | `encodePng` (8-bit grey, value×17) + `ImageQueue`: serial, hash-dedupe, latest-wins, failures reported, never silently retried. |
| `textContainerUpgrade` content ≤ 2000 chars; `containerName` ≤ 16 chars. | Header/footer trimmed (`fitFooter`), names `evt/hdr/ftr/imgL/imgR`. |
| Events: `sysEvent` CLICK=0 (protobuf omits zero → `eventType` undefined), DOUBLE_CLICK=3, FOREGROUND_ENTER/EXIT=4/5; `textEvent` SCROLL_TOP=1 / SCROLL_BOTTOM=2. | Default-inside-envelope event decoding; double-tap = back, and exit at the hub (always-available exit). Foreground re-enter invalidates caches and re-renders. |
| Microphone: `audioControl(true, AudioInputSource.Glasses)` after startup; `audioEvent.audioPcm` PCM 16 kHz s16le mono; needs `g2-microphone` permission. | Push-to-talk capture (5 s max), WAV wrap server-side, OpenAI-compatible STT, honest "not configured" state. |
| `app.json`: `package_id` lowercase reverse-DNS without hyphens, `edition` "202601", `name` ≤ 20 chars, permissions array `{name, desc, whitelist}`; `network` requires a non-empty whitelist. The whitelist does **not** bypass CORS. | All network goes through the STRIKE API (CORS allow-list). `evenhub pack … --sdk-ver 0.0.16` stamps `min_app_version` 2.2.10. |
| Simulator automation: `--automation-port`, `GET /api/ping`, `GET /api/screenshot/glasses` (PNG, alpha = lit pixels), `GET /api/console?since_id=`, `POST /api/input {action: up|down|click|double_click}`. In the simulator `onDeviceStatusChanged` does not fire and IMU is null. | `scripts/sim-verify.mjs` drives 34 steps and stores raw screenshots + console logs. |

## 2. Hyperliquid

Sources: Hyperliquid GitBook (API → info endpoint, exchange endpoint, websocket, tick and lot size, nonces and API wallets, signing, funding, fees), `hyperliquid-python-sdk` (signing reference), live public API responses (recorded in `tests/fixtures/`).

| Fact | Consequence |
|---|---|
| `POST /info` types used: `metaAndAssetCtxs`, `l2Book`, `candleSnapshot {req:{coin,interval,startTime,endTime}}`, `fundingHistory`, `clearinghouseState`, `frontendOpenOrders`, `userFills`, `userFunding`, `orderStatus`, `userRole`, `userFees`. | `InfoClient` with timeouts and typed errors (`http`/`timeout`/`network`). |
| Perp asset id = index in `meta.universe` — **differs between mainnet and testnet** (e.g. testnet BTC=3 at time of probe). Spot = 10000 + index. | Asset ids resolved live per environment (`MetaIndex`); never hard-coded. |
| Prices ≤ 5 significant figures and ≤ (6 − szDecimals) decimals for perps (8 for spot); integers always allowed. Sizes rounded to `szDecimals`. | `roundPrice` with direction (buy bound rounds down, sell bound rounds up), `isValidPrice`, `roundSizeDown`. |
| Minimum order value $10. | Enforced in `buildProposal`. |
| L1 action signing: `keccak(msgpack(action) ‖ nonce(u64 BE) ‖ vault flag [‖ address] [‖ 0x00 ‖ expiresAfter])` → phantom agent `{source: 'a' mainnet / 'b' testnet, connectionId}` under EIP-712 domain `Exchange/1/1337/0x0`. | `signL1Action` reproduces python-SDK vectors byte-for-byte (17 tests, `fixtures/python-sdk-signing.json`). The testnet itself recovered our signer address from a live signed request (see TESTNET.md). |
| `approveAgent` is user-signed EIP-712 (`HyperliquidSignTransaction`, chainId 0x66eee, `hyperliquidChain: "Testnet"`). Agents cannot withdraw/transfer. | Mode D: STRIKE agent key encrypted at rest (AES-256-GCM), approved by the user's wallet on testnet only. |
| Nonces: per signer, must be within (T − 2 days, T + 1 day) and unique among the 100 highest. | `NonceAllocator`: `max(now, last+1)` per signer. |
| `/exchange` returns HTTP 200 even when statuses contain per-order errors. | `parseExchangeResponse` inspects nested statuses → REJECTED / RESTING / FILLED; transport errors → UNKNOWN + reconcile by `cloid`, never blind retry. |
| Funding is paid hourly: `size × oraclePx × rate`. | Funding Clock + Shadow Trade funding/hour. |
| Testnet faucet requires the same address to have deposited on mainnet. | Testnet trading recorded as BLOCKED (owner action). |
| Base-tier fees (perps): taker 0.045 %, maker 0.015 %. | Default fee model in Shadow Trade (labelled "fee schedule, base tier (default)"); real `userFees` used when an address is known. |

## 3. CoinGecko

Sources: CoinGecko API docs (Demo plan, endpoints `search/trending`, `coins/markets`, `global`, `coins/categories`, `coins/{id}`, `search`, `market_chart`; header `x-cg-demo-api-key`; attribution requirements).

- Demo plan: free, 10 000 calls/month, 100 calls/min. STRIKE self-limits to 60/min with an adaptive shared cache, in-flight dedupe, stale fallback and a circuit breaker (3 failures → open → half-open).
- Keyless public API: IP-rate-limited and unpredictable; STRIKE self-limits to 5/min and a 3 000/month budget, and the Radar keeps working without CoinGecko (trending marked unavailable).
- Attribution "Powered by CoinGecko" with link is shown wherever CoinGecko data appears.
- **Mapping is the main risk**: CoinGecko ids ↔ Hyperliquid tickers collide (e.g. `pepe` ↔ `kPEPE`, multiple tokens named the same). STRIKE ships 30 verified mappings; everything else is `candidate`/`ambiguous`/`unmapped` and **cannot prepare an order** (`assertTradable`).

## 4. Design research

- G2 is a monochrome-green HUD read at a glance: STRIKE uses a chunky 8 px bitmap font (Press Start 2P, OFL) inside instruments for crisp 1-bit glyphs, and the firmware font for header/footer prose.
- Every instrument encodes meaning with **shape**: ● position, ○ watchlist, ◇ market, ⚠ funding stress (Radar); △ liquidation, ◆ mark, ○ entry, dashed stop (Orbit); hollow vs filled candles (Replay).
- Companion: obsidian (#0a0b0d) with acid-lime (#c6ff3d) and mint (#4dffb0) accents, Instrument Serif for editorial headlines, Inter Tight for UI, JetBrains Mono for numbers. The companion renders the **same** 4-bit frames as the glasses (lime-tinted canvas) so the phone shows exactly what the glasses show.
