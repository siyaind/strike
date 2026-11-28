import pg from 'pg'
import { SimulatedLedger } from '@strike/trading-core'
import { SentinelTracker } from '@strike/sentinel'
import { DEFAULT_POLICY } from '@strike/risk-engine'
import type { Store, User, Receipt } from './store'

/**
 * Optional Postgres persistence (DATABASE_URL). Tables come from prisma/schema.prisma
 * (`pnpm db:deploy` = prisma migrate deploy). Design: the in-memory Store stays the hot path (synchronous, fast);
 * on boot it is hydrated from Postgres, and changed users are written through every `flushMs` (and on shutdown).
 * Raw session tokens are never stored (only sha256 hashes, as in memory). Agent signer keys are NOT persisted here.
 * Not persisted by design: pairing codes and 30 s confirmation tokens (short-lived, single-use).
 */
export class PgPersistence {
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing: Promise<void> | null = null
  stats = { loadedUsers: 0, flushes: 0, writes: 0, errors: 0, lastError: null as string | null, lastFlushAt: null as number | null }
  constructor(private readonly pool: pg.Pool, private readonly store: Store, private readonly now: () => number = Date.now) {}

  static async connect(url: string, store: Store, now: () => number = Date.now): Promise<PgPersistence> {
    const pool = new pg.Pool({ connectionString: url, max: 4, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined })
    const p = new PgPersistence(pool, store, now)
    const ok = await pool.query(`select to_regclass('public."User"') as t`)
    if (!ok.rows[0]?.t) { await pool.end(); throw new Error('DATABASE_URL set but STRIKE tables are missing — run `pnpm db:deploy` (prisma migrate deploy) first') }
    return p
  }

  start(flushMs = 1500) { this.timer = setInterval(() => void this.flush(), flushMs); this.timer.unref?.() }

  async load(): Promise<number> {
    const t = new Date(this.now())
    const users = await this.pool.query(`select * from "User" where "expiresAt" is null or "expiresAt" > $1`, [t])
    for (const r of users.rows) this.store.users.set(r.id, rowToUser(r))
    const sessions = await this.pool.query(`select * from "Session" where "expiresAt" > $1 and "revokedAt" is null`, [t])
    for (const r of sessions.rows) if (this.store.users.has(r.userId)) this.store.sessions.set(r.tokenHash, { tokenHash: r.tokenHash, userId: r.userId, kind: r.kind, deviceId: r.deviceId, createdAt: +r.createdAt, expiresAt: +r.expiresAt, revoked: false })
    const devices = await this.pool.query(`select * from "Device"`)
    for (const r of devices.rows) if (this.store.users.has(r.userId)) this.store.devices.set(r.id, { id: r.id, userId: r.userId, name: r.name, pairedAt: +r.pairedAt, revokedAt: r.revokedAt ? +r.revokedAt : null, lastSeen: r.lastSeen ? +r.lastSeen : null })
    const receipts = await this.pool.query(`select * from "Receipt" order by "createdAt" asc`)
    for (const r of receipts.rows) { const u = this.store.users.get(r.userId); if (u) u.receipts.push(rowToReceipt(r)) }
    this.store.dirty.clear(); this.store.deleted.clear()
    this.stats.loadedUsers = users.rows.length
    return users.rows.length
  }

  /** Write all dirty users (and their sessions/devices/receipts); delete removed users (cascade). Serialised. */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.doFlush().finally(() => { this.flushing = null })
    return this.flushing
  }
  private async doFlush() {
    const dirty = [...this.store.dirty]; const deleted = [...this.store.deleted]
    this.store.dirty.clear(); this.store.deleted.clear()
    if (!dirty.length && !deleted.length) return
    const c = await this.pool.connect()
    try {
      await c.query('begin')
      if (deleted.length) await c.query(`delete from "User" where id = any($1)`, [deleted])
      for (const id of dirty) {
        const u = this.store.users.get(id); if (!u) continue
        await c.query(`insert into "User"(id, mode, address, "accountEnv", "createdAt", "expiresAt", watchlist, policy, state) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          on conflict (id) do update set address=excluded.address, "accountEnv"=excluded."accountEnv", "expiresAt"=excluded."expiresAt", watchlist=excluded.watchlist, policy=excluded.policy, state=excluded.state`,
          [u.id, u.mode, u.address, u.accountEnv, new Date(u.createdAt), u.expiresAt ? new Date(u.expiresAt) : null, u.watchlist, JSON.stringify(u.policy), JSON.stringify(userState(u))])
        for (const s of this.store.sessions.values()) if (s.userId === id)
          await c.query(`insert into "Session"("tokenHash","userId",kind,"deviceId","createdAt","expiresAt","revokedAt") values ($1,$2,$3,$4,$5,$6,$7)
            on conflict ("tokenHash") do update set "revokedAt"=coalesce("Session"."revokedAt", excluded."revokedAt")`,
            [s.tokenHash, s.userId, s.kind, s.deviceId, new Date(s.createdAt), new Date(s.expiresAt), s.revoked ? new Date(this.now()) : null])
        for (const d of this.store.devices.values()) if (d.userId === id)
          await c.query(`insert into "Device"(id,"userId",name,"pairedAt","lastSeen","revokedAt") values ($1,$2,$3,$4,$5,$6)
            on conflict (id) do update set "lastSeen"=excluded."lastSeen", "revokedAt"=excluded."revokedAt", name=excluded.name`,
            [d.id, d.userId, d.name, new Date(d.pairedAt), d.lastSeen ? new Date(d.lastSeen) : null, d.revokedAt ? new Date(d.revokedAt) : null])
        for (const r of u.receipts)
          await c.query(`insert into "Receipt"(id,"userId","proposalId",env,coin,side,status,"requestedSz","filledSz","avgPx",oid,cloid,"exchangeResponse",transitions,"createdAt") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            on conflict (id) do update set status=excluded.status, "filledSz"=excluded."filledSz", "avgPx"=excluded."avgPx", oid=excluded.oid, "exchangeResponse"=excluded."exchangeResponse", transitions=excluded.transitions`,
            [r.id, id, r.proposalId, r.env, r.coin, r.side, r.status, r.requestedSz, r.filledSz, r.avgPx, r.oid, r.cloid, JSON.stringify({ response: r.exchangeResponse ?? null, label: r.label, reconciled: r.reconciled, protection: r.protection ?? null }), JSON.stringify(r.transitions), new Date(r.createdAt)])
        this.stats.writes++
      }
      await c.query(`delete from "Session" where "expiresAt" < $1`, [new Date(this.now())])
      await c.query('commit')
      this.stats.flushes++; this.stats.lastFlushAt = this.now()
    } catch (e) {
      await c.query('rollback').catch(() => {})
      for (const id of dirty) this.store.dirty.add(id); for (const id of deleted) this.store.deleted.add(id) // retry next tick
      this.stats.errors++; this.stats.lastError = String((e as Error).message).slice(0, 200)
    } finally { c.release() }
  }

  async close() { if (this.timer) clearInterval(this.timer); await this.flush(); await this.pool.end() }
}

function userState(u: User) {
  const l = u.ledger as any
  return {
    ledger: l ? { cash: l.cash, feeRate: l.feeRate, positions: [...l.positions.entries()], fills: l.fills, seq: l.seq } : null,
    sentinel: { events: [...((u.sentinel as any).events as Map<string, unknown>).entries()], seq: (u.sentinel as any).seq },
    watchAddresses: u.watchAddresses, audit: u.audit.slice(-200), voice: u.voice.slice(-100), protectionLog: u.protectionLog.slice(-100),
    knownOids: [...u.knownOids], sessionNotionalUsd: u.sessionNotionalUsd, demoSeeded: u.demoSeeded, lastPositions: u.lastPositions,
  }
}

function rowToUser(r: any): User {
  const st = r.state ?? {}
  let ledger: SimulatedLedger | null = null
  if (st.ledger) { ledger = new SimulatedLedger(st.ledger.cash, st.ledger.feeRate); ledger.positions = new Map(st.ledger.positions); ledger.fills = st.ledger.fills ?? []; (ledger as any).seq = st.ledger.seq ?? 0 }
  else if (r.mode === 'guest') ledger = new SimulatedLedger(10_000)
  const sentinel = new SentinelTracker()
  if (st.sentinel) { (sentinel as any).events = new Map(st.sentinel.events ?? []); (sentinel as any).seq = st.sentinel.seq ?? 0 }
  return {
    id: r.id, mode: r.mode, createdAt: +r.createdAt, expiresAt: r.expiresAt ? +r.expiresAt : null, address: r.address, watchAddresses: st.watchAddresses ?? [],
    watchlist: r.watchlist ?? [], policy: { ...DEFAULT_POLICY, ...(r.policy ?? {}) }, ledger, sentinel, receipts: [], audit: st.audit ?? [], voice: st.voice ?? [],
    sessionNotionalUsd: st.sessionNotionalUsd ?? 0, knownOids: new Set(st.knownOids ?? []), protectionLog: st.protectionLog ?? [], lastPositions: st.lastPositions ?? null,
    accountEnv: r.accountEnv ?? 'testnet', demoSeeded: !!st.demoSeeded,
  }
}

function rowToReceipt(r: any): Receipt {
  const x = r.exchangeResponse ?? {}
  return { id: r.id, proposalId: r.proposalId, env: r.env, label: x.label ?? (r.env === 'testnet' ? 'TESTNET EXECUTION' : 'SIMULATED EXECUTION'), coin: r.coin, side: r.side, status: r.status, requestedSz: r.requestedSz, filledSz: r.filledSz ?? '0', avgPx: r.avgPx, oid: r.oid == null ? null : Number(r.oid), cloid: r.cloid, exchangeResponse: x.response ?? null, transitions: r.transitions ?? [], createdAt: +r.createdAt, reconciled: !!x.reconciled, protection: x.protection ?? undefined }
}
