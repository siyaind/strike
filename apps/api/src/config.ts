import { randomBytes } from 'node:crypto'

export interface ApiConfig {
  port: number
  host: string
  publicOrigin: string // companion origin, used for wallet-auth domain binding + CORS
  allowedOrigins: string[]
  confirmSecret: string
  signerKek: Buffer | null
  coingeckoKey: string | null
  sttUrl: string | null // OpenAI-compatible /v1/audio/transcriptions endpoint (local faster-whisper server or hosted)
  sttKey: string | null
  sttModel: string
  guestTtlMs: number
  maxGuests: number
  offline: boolean // tests: no outbound network
  databaseUrl: string | null // optional Postgres persistence; null → in-memory only
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const origin = env.STRIKE_PUBLIC_ORIGIN ?? 'http://localhost:3100'
  return {
    port: Number(env.PORT ?? 8899),
    host: env.HOST ?? '0.0.0.0',
    publicOrigin: origin,
    allowedOrigins: (env.STRIKE_ALLOWED_ORIGINS ?? `${origin},http://localhost:5180,http://127.0.0.1:5180`).split(',').map((s) => s.trim()).filter(Boolean),
    // Ephemeral per-process secret if unset: tokens simply die on restart (safe default).
    confirmSecret: env.STRIKE_CONFIRM_SECRET ?? randomBytes(32).toString('base64url'),
    signerKek: env.STRIKE_SIGNER_KEK ? Buffer.from(env.STRIKE_SIGNER_KEK, 'base64') : null,
    coingeckoKey: env.COINGECKO_DEMO_API_KEY || null,
    sttUrl: env.STRIKE_STT_URL || null,
    sttKey: env.STRIKE_STT_KEY || null,
    sttModel: env.STRIKE_STT_MODEL ?? 'whisper-1',
    guestTtlMs: Number(env.STRIKE_GUEST_TTL_MS ?? 2 * 3600e3),
    maxGuests: Number(env.STRIKE_MAX_GUESTS ?? 500),
    offline: env.STRIKE_OFFLINE === '1',
    databaseUrl: env.DATABASE_URL || null,
  }
}
