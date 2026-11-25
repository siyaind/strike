import { randomId, sha256Hex } from '@strike/security'
import { SimulatedLedger } from '@strike/trading-core'
import { DEFAULT_POLICY, type RiskPolicy } from '@strike/risk-engine'
import { SentinelTracker } from '@strike/sentinel'

export type Mode = 'guest' | 'watch' | 'wallet'
export interface User {
  id: string; mode: Mode; createdAt: number; expiresAt: number | null
  address: string | null // verified master (wallet) or watched (watch) — never an agent address
  watchAddresses: string[]
  watchlist: string[]; policy: RiskPolicy
  ledger: SimulatedLedger | null
  sentinel: SentinelTracker
  receipts: Receipt[]; audit: AuditEvent[]; voice: VoiceRecord[]
  sessionNotionalUsd: number
  knownOids: Set<number>
  protectionLog: Array<{ t: number; coin: string; ok: boolean; detail: string }>
  lastPositions: any[] | null
  accountEnv: 'mainnet' | 'testnet'
  demoSeeded: boolean
}
export interface Session { tokenHash: string; userId: string; kind: 'browser' | 'device'; deviceId: string | null; createdAt: number; expiresAt: number; revoked: boolean }
export interface Device { id: string; userId: string; name: string; pairedAt: number; revokedAt: number | null; lastSeen: number | null }
export interface Receipt { id: string; proposalId: string; env: 'simulated' | 'testnet'; label: 'SIMULATED EXECUTION' | 'TESTNET EXECUTION'; coin: string; side: 'buy' | 'sell'; status: string; requestedSz: string; filledSz: string; avgPx: string | null; oid: number | null; cloid: string | null; exchangeResponse: unknown; transitions: unknown[]; createdAt: number; reconciled: boolean; protection?: unknown }
export interface AuditEvent { t: number; type: string; detail: string }
export interface VoiceRecord { t: number; transcript: string; source: 'stt' | 'typed' | 'test'; intent: unknown; confidence: number | null }

export class Store {
  users = new Map<string, User>()
  sessions = new Map<string, Session>()
  devices = new Map<string, Device>()
  pairing = new Map<string, { userId: string; expiresAt: number; attempts: number }>()
  constructor(private readonly now: () => number = Date.now) {}

  createUser(mode: Mode, ttlMs: number | null, address: string | null = null): User {
    const t = this.now()
    const u: User = { id: randomId('usr_'), mode, createdAt: t, expiresAt: ttlMs ? t + ttlMs : null, address: address?.toLowerCase() ?? null, watchAddresses: [], watchlist: ['BTC', 'ETH', 'HYPE'], policy: { ...DEFAULT_POLICY }, ledger: mode === 'guest' ? new SimulatedLedger(10_000) : null, sentinel: new SentinelTracker(), receipts: [], audit: [], voice: [], sessionNotionalUsd: 0, knownOids: new Set(), protectionLog: [], lastPositions: null, accountEnv: 'testnet', demoSeeded: false }
    this.users.set(u.id, u)
    return u
  }
  findWalletUser(address: string) { for (const u of this.users.values()) if (u.mode === 'wallet' && u.address === address.toLowerCase()) return u; return null }
  issueSession(userId: string, kind: Session['kind'], ttlMs: number, deviceId: string | null = null): string {
    const token = randomId('stk_', 32)
    this.sessions.set(sha256Hex(token), { tokenHash: sha256Hex(token), userId, kind, deviceId, createdAt: this.now(), expiresAt: this.now() + ttlMs, revoked: false })
    return token
  }
  resolve(token: string | undefined): { user: User; session: Session } | null {
    if (!token) return null
    const s = this.sessions.get(sha256Hex(token))
    if (!s || s.revoked || this.now() > s.expiresAt) return null
    if (s.deviceId) { const d = this.devices.get(s.deviceId); if (!d || d.revokedAt) return null; d.lastSeen = this.now() }
    const u = this.users.get(s.userId)
    if (!u || (u.expiresAt && this.now() > u.expiresAt)) return null
    return { user: u, session: s }
  }
  revokeSessionsFor(userId: string) { for (const s of this.sessions.values()) if (s.userId === userId) s.revoked = true }
  audit(u: User, type: string, detail: string) { u.audit.push({ t: this.now(), type, detail }); if (u.audit.length > 500) u.audit.shift() }

  /** Guest lifecycle: delete expired guests + all their state (ledger, receipts, sessions). Bounded total. */
  cleanup(maxGuests: number): { removedUsers: number; removedSessions: number } {
    const t = this.now()
    let removedUsers = 0, removedSessions = 0
    for (const [id, u] of this.users) if (u.expiresAt && t > u.expiresAt) { this.users.delete(id); removedUsers++ }
    const guests = [...this.users.values()].filter((u) => u.mode === 'guest').sort((a, b) => a.createdAt - b.createdAt)
    while (guests.length > maxGuests) { const g = guests.shift()!; this.users.delete(g.id); removedUsers++ }
    for (const [k, s] of this.sessions) if (t > s.expiresAt || s.revoked || !this.users.has(s.userId)) { this.sessions.delete(k); removedSessions++ }
    for (const [k, p] of this.pairing) if (t > p.expiresAt || !this.users.has(p.userId)) this.pairing.delete(k)
    for (const [k, d] of this.devices) if (!this.users.has(d.userId)) this.devices.delete(k)
    return { removedUsers, removedSessions }
  }
  guestCount() { let n = 0; for (const u of this.users.values()) if (u.mode === 'guest') n++; return n }
}
