import { createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'node:crypto'

export function randomId(prefix = '', bytes = 16) { return `${prefix}${randomBytes(bytes).toString('base64url')}` }
export function sha256Hex(s: string) { return createHash('sha256').update(s).digest('hex') }

/** Canonical JSON (sorted keys) so the same parameters always hash identically. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  return `{${Object.keys(v as object).filter((k) => (v as any)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(',')}}`
}

export function hmac(secret: string | Buffer, data: string) { return createHmac('sha256', secret).update(data).digest('base64url') }
export function safeEqual(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** AES-256-GCM envelope for signer secrets at rest. Key comes from protected env (STRIKE_SIGNER_KEK, 32 bytes base64). */
export function encryptSecret(plaintext: string, kek: Buffer, aad: string) {
  if (kek.length !== 32) throw new Error('KEK must be 32 bytes')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', kek, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${c.getAuthTag().toString('base64url')}`
}
export function decryptSecret(envelope: string, kek: Buffer, aad: string) {
  const [v, iv, ct, tag] = envelope.split('.')
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('Bad envelope')
  const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(iv, 'base64url'))
  d.setAAD(Buffer.from(aad)); d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

const SECRET_PATTERNS: RegExp[] = [/0x[0-9a-fA-F]{64}\b/g, /CG-[A-Za-z0-9]{10,}/g, /\b(sk|pk)_[A-Za-z0-9]{16,}/g, /"(privateKey|secret|apiKey|password|seed|mnemonic|token)"\s*:\s*"[^"]*"/gi]
/** Redact private keys, API keys and secret-looking JSON fields from any log line or error. */
export function redact(s: string): string {
  let out = s
  for (const p of SECRET_PATTERNS) out = out.replace(p, (m) => (m.startsWith('"') ? m.replace(/:\s*"[^"]*"/, ':"[REDACTED]"') : '[REDACTED]'))
  return out
}

/** Fixed-window-ish token bucket per key. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; ts: number }>()
  constructor(private readonly capacity: number, private readonly refillPerSec: number, private readonly now: () => number = Date.now) {}
  take(key: string, cost = 1): boolean {
    const t = this.now()
    const b = this.buckets.get(key) ?? { tokens: this.capacity, ts: t }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.ts) / 1000) * this.refillPerSec); b.ts = t
    if (b.tokens < cost) { this.buckets.set(key, b); return false }
    b.tokens -= cost; this.buckets.set(key, b); return true
  }
  size() { return this.buckets.size }
}

/** Prompt-injection guard for any free text that might reach an LLM/summariser: strip instructions, cap length.
 * STRIKE's voice pipeline is deterministic; this is defence-in-depth for transcripts and asset descriptions. */
/** Remove control characters only (user-authored input such as typed voice commands). */
export function stripControl(s: string, max = 500) {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)
}
/** For third-party text (e.g. CoinGecko descriptions) displayed to users: never treated as instructions. */
export function sanitizeUntrustedText(s: string, max = 500) {
  return stripControl(s, max * 2).replace(/\b(ignore (all|previous|prior) instructions|system prompt|you are now|execute|confirm the order|sign)\b/gi, '[filtered]').slice(0, max)
}
