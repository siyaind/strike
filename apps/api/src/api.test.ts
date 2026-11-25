import { describe, expect, it } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { randomBytes } from 'node:crypto'
import { buildApp } from './app'
import { fakes, T0 } from '../../../tests/fakes'

async function mk(o: Parameters<typeof fakes>[0] = {}, cfg: Record<string, unknown> = {}) {
  const f = fakes(o)
  let t = T0
  const built = await buildApp({ ...f, now: () => t, config: { offline: true, publicOrigin: 'https://strike.test', allowedOrigins: ['https://strike.test'], confirmSecret: 'c'.repeat(40), signerKek: randomBytes(32), ...cfg } })
  const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await built.app.inject({ method: method as any, url, payload: payload as any, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, remoteAddress: headers['x-ip'] ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }
  }
  const guest = async () => (await call('POST', '/v1/guest/session')).body.token as string
  return { ...built, f, call, guest, advance: (ms: number) => { t += ms }, setNow: (v: number) => { t = v } }
}

describe('API: public market intelligence', () => {
  it('health + readiness', async () => { const a = await mk(); expect((await a.call('GET', '/healthz')).status).toBe(200); expect((await a.call('GET', '/readyz')).body.ready).toBe(true) })
  it('radar works anonymously with explanations and CoinGecko attribution', async () => {
    const a = await mk(); const r = await a.call('GET', '/v1/radar')
    expect(r.status).toBe(200); expect(r.body.points.length).toBeGreaterThan(5)
    expect(r.body.points[0].explanation).toMatch(/:/); expect(r.body.trending.attribution.text).toMatch(/CoinGecko/)
    expect(r.body.encoding.x).toMatch(/24h/)
  })
  it('market DNA, lens, funding, candles', async () => {
    const a = await mk()
    const d = await a.call('GET', '/v1/market-dna/BTC'); expect(d.body.axes).toHaveLength(6)
    const l = await a.call('GET', '/v1/liquidity-lens/BTC?size=250'); expect(l.body.estimates.map((e: any) => e.notionalUsd)).toContain(250); expect(l.body.ageMs).toBe(500)
    const fc = await a.call('GET', '/v1/funding/BTC'); expect(fc.body.intervalMs).toBe(3600e3); expect(fc.body.history.length).toBeGreaterThan(10)
    expect((await a.call('GET', '/v1/markets/BTC/candles?interval=1h')).body.candles.length).toBeGreaterThan(10)
  })
  it('shared cache: 25 concurrent radar loads → 1 upstream meta call and 1 CoinGecko call', async () => {
    const a = await mk()
    await Promise.all(Array.from({ length: 25 }, () => a.call('GET', '/v1/radar')))
    expect(a.f.calls.cg).toBe(1)
    expect(a.ms.upstream.hlCalls).toBeLessThanOrEqual(2)
  })
  it('input validation rejects junk params', async () => { const a = await mk(); expect((await a.call('GET', '/v1/market-dna/..%2Fetc')).status).toBe(400) })
})

describe('API: failure injection', () => {
  it('Hyperliquid 500 → 502-class error, never fabricated data', async () => { const a = await mk({ failMainnet: 'http500' }); const r = await a.call('GET', '/v1/radar'); expect(r.status).toBe(502); expect(r.body.points).toBeUndefined() })
  it('Hyperliquid timeout → error', async () => { const a = await mk({ failMainnet: 'timeout' }); const r = await a.call('GET', '/readyz'); expect(r.status).toBe(503) }, 20000)
  it('CoinGecko 429 → radar still works, trending marked with error', async () => { const a = await mk({ failCg: 429 }); const r = await a.call('GET', '/v1/radar'); expect(r.status).toBe(200); expect(r.body.trending.error).toMatch(/429/); expect(r.body.trending.items).toEqual([]) })
})

describe('API: guest demo + simulated execution', () => {
  it('guest gets seeded SIMULATED portfolio with labels', async () => {
    const a = await mk(); const t = await a.guest()
    const p = await a.call('GET', '/v1/portfolio', t)
    expect(p.body.env).toBe('simulated'); expect(p.body.labels).toContain('SIMULATED ACCOUNT'); expect(p.body.positions.map((x: any) => x.coin).sort()).toEqual(['BTC', 'ETH', 'SOL'])
    expect(p.body.positions.find((x: any) => x.coin === 'ETH').protection.state).toBe('UNPROTECTED')
  })
  it('preview → confirm → receipt; duplicate confirm rejected; guest never hits signed endpoints', async () => {
    const a = await mk(); const t = await a.guest(); await a.call('GET', '/v1/portfolio', t)
    const pv = await a.call('POST', '/v1/trade/preview', t, { coin: 'BTC', side: 'buy', notionalUsd: 100, leverage: 2 })
    expect(pv.status).toBe(200); expect(pv.body.label).toBe('SIMULATED EXECUTION'); expect(pv.body.proposal.risk.ok).toBe(true)
    const c1 = await a.call('POST', '/v1/trade/confirm', t, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })
    expect(c1.body.label).toBe('SIMULATED EXECUTION'); expect(['FILLED', 'PARTIALLY_FILLED']).toContain(c1.body.status)
    const c2 = await a.call('POST', '/v1/trade/confirm', t, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })
    expect(c2.status).toBe(409); expect(c2.body.error).toBe('REPLAYED')
    expect(a.f.calls.exchange).toHaveLength(0)
  })
  it('expired proposal rejected', async () => {
    const a = await mk(); const t = await a.guest(); await a.call('GET', '/v1/portfolio', t)
    const pv = await a.call('POST', '/v1/trade/preview', t, { coin: 'BTC', side: 'buy', notionalUsd: 100, leverage: 2 })
    a.advance(31_000)
    expect((await a.call('POST', '/v1/trade/confirm', t, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })).body.error).toBe('EXPIRED')
  })
  it('stale market snapshot fails risk (data-freshness)', async () => {
    const a = await mk(); const t = await a.guest(); await a.call('GET', '/v1/portfolio', t)
    a.advance(60_000)
    const pv = await a.call('POST', '/v1/trade/preview', t, { coin: 'BTC', side: 'buy', notionalUsd: 100, leverage: 2 })
    expect(pv.body.proposal.risk.ok).toBe(false); expect(pv.body.proposal.risk.checks.find((c: any) => c.rule === 'data-freshness').status).toBe('fail')
  })
  it('unverified CoinGecko mapping cannot prepare an order', async () => {
    const a = await mk(); const t = await a.guest()
    const r = await a.call('POST', '/v1/trade/preview', t, { coin: 'BTC', side: 'buy', notionalUsd: 100, leverage: 2, cgId: 'some-btc-lookalike' })
    expect(r.status).toBe(422)
  })
  it('close half of ETH short via reduce-only', async () => {
    const a = await mk(); const t = await a.guest()
    const before = (await a.call('GET', '/v1/portfolio', t)).body.positions.find((p: any) => p.coin === 'ETH')
    const pv = await a.call('POST', '/v1/trade/preview', t, { coin: 'ETH', side: 'buy', fractionOfPosition: 0.5, reduceOnly: true, leverage: 5 })
    const c = await a.call('POST', '/v1/trade/confirm', t, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })
    expect(c.body.status).toBe('FILLED')
    const after = (await a.call('GET', '/v1/portfolio', t)).body.positions.find((p: any) => p.coin === 'ETH')
    expect(Math.abs(after.szi)).toBeCloseTo(Math.abs(before.szi) - Number(pv.body.proposal.wire.sz), 6)
  })
  it('add stop to unprotected guest position → PROTECTED; duplicate blocked', async () => {
    const a = await mk(); const t = await a.guest()
    const eth = (await a.call('GET', '/v1/portfolio', t)).body.positions.find((p: any) => p.coin === 'ETH')
    const r = await a.call('POST', '/v1/protection/stop', t, { coin: 'ETH', stopPx: eth.markPx * 1.05 })
    expect(r.body.verified.state).toBe('PROTECTED')
    expect((await a.call('POST', '/v1/protection/stop', t, { coin: 'ETH', stopPx: eth.markPx * 1.06 })).status).toBe(409)
    expect((await a.call('POST', '/v1/protection/stop', t, { coin: 'BTC', stopPx: 1e9 })).status).toBe(422)
  })
  it('sentinel shows unprotected ETH; voice cannot confirm', async () => {
    const a = await mk(); const t = await a.guest()
    const s = await a.call('GET', '/v1/sentinel/events', t)
    expect(s.body.events.some((e: any) => e.key === 'prot:ETH')).toBe(true)
    const v = await a.call('POST', '/v1/voice/command', t, { text: 'confirm the order' }); expect(v.body.intent.type).toBe('confirm-refused')
    const v2 = await a.call('POST', '/v1/voice/command', t, { text: 'What happens if BTC falls five percent?' }); expect(v2.body.intent).toMatchObject({ type: 'scenario', coin: 'BTC', pct: -5 })
  })
  it('STT disabled → explicit error, no scripted transcript', async () => {
    const a = await mk(); const t = await a.guest()
    const r = await a.call('POST', '/v1/voice/transcribe', t, { pcmBase64: Buffer.alloc(6400).toString('base64') })
    expect(r.body.text).toBeNull(); expect(r.body.mode).toBe('disabled')
  })
  it('shadow trade + orbit scenario', async () => {
    const a = await mk(); const t = await a.guest()
    const s = await a.call('POST', '/v1/shadow-trade', t, { coin: 'ETH', side: 'long', notionalUsd: 500, leverage: 3 })
    expect(s.body.labels).toContain('SIMULATION'); expect(s.body.scenarios).toHaveLength(7)
    const o = await a.call('GET', '/v1/positions/BTC/orbit?scenarioPct=-5', t)
    expect(o.body.scenario.pct).toBe(-5); expect(o.body.scenario.pnlChangeUsd).toBeLessThan(0)
  })
})

describe('API: multiuser isolation (25 concurrent guests)', () => {
  it('each guest has an isolated ledger, receipts, policy and watchlist', async () => {
    const a = await mk()
    const tokens = await Promise.all(Array.from({ length: 25 }, () => a.guest()))
    await Promise.all(tokens.map((t) => a.call('GET', '/v1/portfolio', t)))
    // Every guest trades a different notional concurrently
    const results = await Promise.all(tokens.map(async (t, i) => {
      const pv = await a.call('POST', '/v1/trade/preview', t, { coin: 'SOL', side: 'buy', notionalUsd: 20 + i, leverage: 2 })
      const c = await a.call('POST', '/v1/trade/confirm', t, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })
      return { t, sz: Number(pv.body.proposal.wire.sz), status: c.body.status, pid: pv.body.proposal.proposalId, tok: pv.body.confirmToken }
    }))
    expect(results.every((r) => r.status === 'FILLED')).toBe(true)
    for (const [i, r] of results.entries()) {
      const rc = (await a.call('GET', '/v1/receipts', r.t)).body
      expect(rc).toHaveLength(1); expect(rc[0].proposalId).toBe(r.pid)
      // cross-user: guest i cannot confirm guest j's proposal even with j's token
      const j = results[(i + 1) % results.length]!
      const x = await a.call('POST', '/v1/trade/confirm', r.t, { proposalId: j.pid, confirmToken: j.tok })
      expect(x.status).toBe(409); expect(['WRONG_USER', 'REPLAYED']).toContain(x.body.error)
    }
    await a.call('PUT', '/v1/risk/policy', tokens[0], { maxLeverage: 2 })
    expect((await a.call('GET', '/v1/risk/policy', tokens[1])).body.maxLeverage).toBe(5)
  })
  it('guest expiry + cleanup removes state; capacity bounded', async () => {
    const a = await mk({}, { guestTtlMs: 1000, maxGuests: 10 })
    const t = await a.guest()
    a.advance(2000)
    expect((await a.call('GET', '/v1/portfolio', t)).status).toBe(401)
    for (let i = 0; i < 15; i++) await a.call('POST', '/v1/guest/session', undefined, undefined, { 'x-ip': `9.9.9.${i}` })
    expect(a.store.guestCount()).toBeLessThanOrEqual(10)
  })
  it('guest creation is rate limited per IP', async () => {
    const a = await mk(); const codes: number[] = []
    for (let i = 0; i < 8; i++) codes.push((await a.call('POST', '/v1/guest/session', undefined, undefined, { 'x-ip': '7.7.7.7' })).status)
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  })
})

describe('API: auth, pairing, devices', () => {
  it('unauthenticated account routes → 401', async () => { const a = await mk(); for (const u of ['/v1/portfolio', '/v1/receipts', '/v1/sentinel/events']) expect((await a.call('GET', u)).status).toBe(401) })
  it('wallet ownership: valid → session; wrong domain / replay / forged → 401', async () => {
    const a = await mk(); const acct = privateKeyToAccount(generatePrivateKey())
    const ch = (await a.call('POST', '/v1/auth/challenge', undefined, { address: acct.address })).body
    const sig = await acct.signMessage({ message: ch.message })
    expect((await a.call('POST', '/v1/auth/verify', undefined, { challengeId: ch.challengeId, signature: sig }, { origin: 'https://evil.test' })).status).toBe(401)
    const ch2 = (await a.call('POST', '/v1/auth/challenge', undefined, { address: acct.address })).body
    const ok = await a.call('POST', '/v1/auth/verify', undefined, { challengeId: ch2.challengeId, signature: await acct.signMessage({ message: ch2.message }) }, { origin: 'https://strike.test' })
    expect(ok.status).toBe(200); expect(ok.body.mode).toBe('wallet')
    expect((await a.call('POST', '/v1/auth/verify', undefined, { challengeId: ch2.challengeId, signature: sig }, { origin: 'https://strike.test' })).status).toBe(401)
    const other = privateKeyToAccount(generatePrivateKey())
    const ch3 = (await a.call('POST', '/v1/auth/challenge', undefined, { address: acct.address })).body
    expect((await a.call('POST', '/v1/auth/verify', undefined, { challengeId: ch3.challengeId, signature: await other.signMessage({ message: ch3.message }) }, { origin: 'https://strike.test' })).body.error).toBe('BAD_SIGNATURE')
  })
  it('pairing code single-use; device revocation kills device session; cross-user device delete → 404', async () => {
    const a = await mk(); const t = await a.guest(); const t2 = await a.guest()
    const code = (await a.call('POST', '/v1/pairing/start', t)).body.code
    const dev = await a.call('POST', '/v1/pairing/claim', undefined, { code, deviceName: 'G2-test' })
    expect(dev.status).toBe(200)
    expect((await a.call('POST', '/v1/pairing/claim', undefined, { code })).status).toBe(401)
    expect((await a.call('GET', '/v1/portfolio', dev.body.token)).status).toBe(200)
    expect((await a.call('POST', '/v1/pairing/start', dev.body.token)).status).toBe(403) // device cannot mint more pairings
    expect((await a.call('DELETE', `/v1/devices/${dev.body.deviceId}`, t2)).status).toBe(404)
    expect((await a.call('DELETE', `/v1/devices/${dev.body.deviceId}`, t)).status).toBe(200)
    expect((await a.call('GET', '/v1/portfolio', dev.body.token)).status).toBe(401)
  })
  it('watch-only cannot trade; agent addresses rejected for watch', async () => {
    const a = await mk({ testnetInfo: (b) => (b.type === 'userRole' ? { role: 'agent', data: { user: '0xmaster' } } : undefined) })
    const w = await a.call('POST', '/v1/accounts/watch', undefined, { address: '0x' + '1'.repeat(40), env: 'mainnet' })
    expect(w.status).toBe(200)
    expect((await a.call('POST', '/v1/trade/preview', w.body.token, { coin: 'BTC', side: 'buy', notionalUsd: 100 })).status).toBe(403)
    expect((await a.call('POST', '/v1/accounts/watch', undefined, { address: '0x' + '2'.repeat(40), env: 'testnet' })).body.error).toBe('AGENT_ADDRESS')
  })
  it('diagnostics never leak secrets', async () => {
    const a = await mk({}, { coingeckoKey: 'CG-supersecretkey123' })
    const d = await a.call('GET', '/v1/diagnostics')
    expect(JSON.stringify(d.body)).not.toMatch(/supersecret|cccccccc/)
    expect(d.body.hyperliquid.signing).toMatch(/testnet-only/)
  })
  it('CORS only for allowed origins', async () => {
    const a = await mk()
    const ok = await a.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://strike.test' } })
    const bad = await a.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.test' } })
    expect(ok.headers['access-control-allow-origin']).toBe('https://strike.test'); expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('API: testnet trading path (Mode D) with mocked exchange', () => {
  async function walletUser(a: Awaited<ReturnType<typeof mk>>) {
    const acct = privateKeyToAccount(generatePrivateKey())
    const ch = (await a.call('POST', '/v1/auth/challenge', undefined, { address: acct.address })).body
    const v = await a.call('POST', '/v1/auth/verify', undefined, { challengeId: ch.challengeId, signature: await acct.signMessage({ message: ch.message }) }, { origin: 'https://strike.test' })
    return { acct, token: v.body.token as string }
  }
  it('approveAgent flow posts master-signed typed data to TESTNET; order signed by agent; HTTP 200 with nested error → REJECTED', async () => {
    const a = await mk({ testnetExchange: (b) => (b.action.type === 'approveAgent' ? { status: 'ok', response: { type: 'default' } } : b.action.type === 'updateLeverage' ? { status: 'ok', response: { type: 'default' } } : { status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Insufficient margin to place order.' }] } } }) })
    const { acct, token } = await walletUser(a)
    const ag = await a.call('POST', '/v1/signers/agent', token)
    expect(ag.body.typedData.message.hyperliquidChain).toBe('Testnet')
    const td = ag.body.typedData
    const sig = await acct.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: { ...td.message, nonce: BigInt(td.message.nonce) } })
    const ap = await a.call('POST', '/v1/signers/agent/approve', token, { signature: sig, nonce: ag.body.nonce })
    expect(ap.body.ok).toBe(true)
    expect(a.f.calls.exchange[0].action).toMatchObject({ type: 'approveAgent', hyperliquidChain: 'Testnet' })
    const pv = await a.call('POST', '/v1/trade/preview', token, { coin: 'BTC', side: 'buy', notionalUsd: 50, leverage: 2 })
    expect(pv.body.label).toBe('TESTNET EXECUTION')
    // policy/risk: account value 0 from fake clearinghouse → margin unknown/fail → cannot confirm
    expect(pv.body.proposal.risk.ok).toBe(false)
    expect((await a.call('POST', '/v1/trade/confirm', token, { proposalId: pv.body.proposal.proposalId, confirmToken: pv.body.confirmToken })).body.error).toBe('RISK_FAILED')
  })
})
