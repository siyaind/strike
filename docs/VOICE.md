# Voice

All voice input ends in the same deterministic grammar (`@strike/voice-engine` `parseCommand`). The result is an **intent shown for review**; navigation/scenario intents can open screens or previews, but **voice can never confirm an order** — "confirm" in any phrasing returns `confirm-refused`, and execution requires the preview screen's CONFIRM tap/click.

| Path | Where | Cost | Status |
|---|---|---|---|
| Browser speech (Web Speech API: `SpeechRecognition` / `webkitSpeechRecognition`) | Companion `/voice` (🎙 Speak) and the glasses app's phone WebView panel | Free, no key | Implemented · unit-tested (fake recognizer) · Playwright-tested with a mocked recognizer. Works in Chrome/Edge/Safari; not Firefox. Whether the Even app WebView exposes it is **not verified** (no hardware) — the button only appears when supported. |
| Typed | Companion `/voice`, glasses phone panel | Free | Implemented · tested. Always available fallback. |
| G2 microphone → server STT | Glasses: Hub → VOICE → tap (5 s push-to-talk, 16 kHz PCM) → `POST /v1/voice/transcribe` → `STRIKE_STT_URL` | Self-hosted faster-whisper is free (`services/stt/docker-compose.yml`) | Implemented; **optional and off** in the public deploy (no provider chosen, no paid STT). Glasses show "SERVER STT OFF – SPEAK OR TYPE ON PHONE". |

Sources are recorded per command (`browser-stt`, `typed`, `stt`) with confidence when the engine provides it. Raw audio is never stored.

Configure server STT (optional): `STRIKE_STT_URL` (OpenAI-compatible `/v1/audio/transcriptions`), `STRIKE_STT_KEY`, `STRIKE_STT_MODEL`.
