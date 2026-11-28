import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { buildApp } from './app'
import { fakes, T0 } from '../../../tests/fakes'

/** Real Postgres round-trip. Runs when STRIKE_TEST_DATABASE_URL points at a DB migrated with `pnpm db:deploy`. */
const DB = process.env.STRIKE_TEST_DATABASE_URL

async function boot(databaseUrl: string | null) {
  let t = T0
  const built = await buildApp({ ...fakes(), now: () => t, config: { offline: true, publicOrigin: 'https://strike.test', allowedOrigins: [], confirmSecret: 'p'.repeat(40), signerKek: null, databaseUrl } })
  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const r = await built.app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {}, remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.1` })
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }
  }
  return { ...built, call }
}

describe.skipIf(!DB)('Postgres persistence (optional DATABASE_URL)', () => {
  it('survives a restart: session, simulated position, receipt, watchlist, voice history', async () => {
    const pool = new pg.Pool({ connectionString: DB }); await pool.query('truncate "User" cascade'); await pool.end()
    const a = await boot(DB!)
    expect(a.persistence).not.toBeNull()
    const token = (await a.call('POST', '/v1/guest/session')).body.token as string
    await a.call('GET', '/v1/portfolio', token)
    const pv = await a.call('POST', '/v1/trade/preview', token, { coin: 'BTC', side: 'buy', notionalUsd: 100, leverage: 2 })
    const rc = await a.call('POST', '/v1/trade/confirm', token, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })
    expect(['FILLED', 'PARTIALLY_FILLED']).toContain(rc.body.status)
    await a.call('POST', '/v1/voice/command', token, { text: 'show me the radar', source: 'browser-stt' })
    const before = (await a.call('GET', '/v1/portfolio', token)).body
    const diag = (await a.call('GET', '/v1/diagnostics')).body
    expect(diag.persistence.mode).toBe('postgres')
    expect(JSON.stringify(diag)).not.toContain('postgresql://')
    await a.app.close() // flushes

    const b = await boot(DB!) // "restart"
    const me = await b.call('GET', '/v1/me', token)
    expect(me.status).toBe(200); expect(me.body.mode).toBe('guest')
    const after = (await b.call('GET', '/v1/portfolio', token)).body
    expect(after.positions.map((p: any) => [p.coin, p.szi])).toEqual(before.positions.map((p: any) => [p.coin, p.szi]))
    expect(b.store.users.get(me.body.userId)!.receipts.map((r) => r.id)).toContain(rc.body.id)
    expect((await b.call('GET', '/v1/voice/history', token)).body[0].source).toBe('browser-stt')
    // replay protection is not weakened by persistence: the old confirm token is dead after restart
    expect((await b.call('POST', '/v1/trade/confirm', token, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })).status).toBeGreaterThanOrEqual(400)
    // raw tokens are never stored, only hashes
    const pool2 = new pg.Pool({ connectionString: DB }); const rows = await pool2.query('select "tokenHash" from "Session"'); await pool2.end()
    expect(rows.rows.length).toBeGreaterThan(0); expect(rows.rows.map((r) => r.tokenHash)).not.toContain(token)
    await b.app.close()
  })
})

describe('Postgres persistence fallback', () => {
  it('falls back to the in-memory store when DATABASE_URL is unreachable (no URL leaked)', async () => {
    const a = await boot('postgresql://nobody:secretpw@127.0.0.1:1/none')
    expect(a.persistence).toBeNull()
    const d = (await a.call('GET', '/v1/diagnostics')).body
    expect(d.persistence.mode).toBe('memory'); expect(JSON.stringify(d)).not.toContain('secretpw')
    expect((await a.call('POST', '/v1/guest/session')).status).toBe(200)
    await a.app.close()
  })
})
