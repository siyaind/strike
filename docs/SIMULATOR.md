# G2 simulator verification

Tool: the **official** `@evenrealities/evenhub-simulator@0.9.5`, driven through its automation API. Evidence: `evidence/g2-simulator/` (raw screenshots: PNG where alpha = lit pixel), `evidence/g2-simulator/view/` (green-on-black 2× renders + `contact-sheet.png`), `sim-run.json` (steps, timestamps, last render log per step), `console.log.json` (full WebView console).

```bash
pnpm dev:api                               # STRIKE API on :8899 (live public Hyperliquid data)
pnpm dev:glasses                           # Vite on :5180
evenhub-simulator http://localhost:5180 --automation-port 9898
pnpm sim && pnpm sim:view                  # drive flows, then build viewable renders
```

## Latest run (28 Nov 2026, 12:35 IST / 07:05 UTC)

Result `ok: true`, **32 screenshots, 0 image-transfer failures, 1 console error** — the error is an expected `401 /v1/me` from a session token left in the simulator's localStorage by an earlier run (the API restarted with an in-memory store); the app discarded it and started a fresh guest session. 32 vs 34 steps: in this run the radar's first market had no simulated position, so the flow went straight to DNA (no Orbit step there); Orbit is still covered via Positions → BTC. The voice step now tells the user to speak/type on the phone (free Web Speech API or typed) when no G2 mic/server STT is available.

## First run (25 Nov 2026, 11:32 IST / 06:02 UTC)

Result `ok: true`, **34 screenshots, 0 console errors, 0 image-transfer failures** (every render logs ImageQueue metrics after `updateImageRawData` resolves). Screenshots in the repo are from the latest run.

| Flow | Steps |
|---|---|
| A Onboarding | welcome → guest demo session → hub |
| B Radar | live radar, swipe selection ×2 |
| C/F Market → Orbit | open selected market (ETH short, UNPROTECTED) → Orbit scenario −10 % → DNA, axis selection |
| D Lens | $100 → $250 sizing (side follows the position) |
| E Shadow | scenarios −2 %, −5 %, select PREVIEW ORDER |
| G Execution | preview (CANCEL default) → tap cancels → preview again → swipe CONFIRM → **SIMULATED** receipt → back |
| E Funding | funding clock |
| F Positions | positions list with protection state → BTC Orbit (PROTECTED) |
| H Sentinel | 2 WARNING events (unprotected positions) |
| I Voice | listening → honest fallback (simulator emits no G2 audio events; use phone speech/typed) |

Limits: the simulator does not emulate IMU or device status; real-hardware rendering (brightness, latency over BLE) is **not verified** — no G2 hardware was available.
