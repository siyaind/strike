# STRIKE speech-to-text

STRIKE never fakes transcripts. If no STT endpoint is configured, `/v1/voice/transcribe` returns `{ text: null, mode: "disabled" }` and the glasses show **SPEECH-TO-TEXT NOT CONFIGURED**.

Any OpenAI-compatible `/v1/audio/transcriptions` endpoint works. The free, self-hosted option:

```bash
docker compose -f services/stt/docker-compose.yml up -d
export STRIKE_STT_URL=http://localhost:8000/v1/audio/transcriptions
export STRIKE_STT_MODEL=Systran/faster-whisper-small.en
```

Audio path: G2 microphone → PCM 16 kHz s16le mono (Even Hub `audioEvent`) → glasses app (push-to-talk, max 5 s) → STRIKE API wraps it in WAV → STT → deterministic grammar (`packages/voice-engine`). Voice can navigate and prepare previews; it can never confirm an order.

Status: client implemented and unit-tested with a mocked endpoint; the container above was **not run** in this environment (owner decision on hosting/provider pending).
