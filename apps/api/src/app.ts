import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { z } from 'zod'
import { InfoClient, HlWsMultiplexer, CANDLE_INTERVALS, FUNDING_INTERVAL_MS, approveAgentTypedData, type CandleInterval } from '@strike/hyperliquid'
import { CoinGeckoClient, COINGECKO_ATTRIBUTION } from '@strike/coingecko'
import { buildRadar, explainRadar, marketDna, liquidityLens, fundingClock, SIZE_PRESETS, RADAR_CATEGORIES } from '@strike/market-intelligence'
import { shadowTrade, SCENARIOS_PCT } from '@strike/shadow-trade'
import { ConfirmationRegistry, ConfirmationError, ProposalError } from '@strike/trading-core'
import { evaluateSentinel } from '@strike/sentinel'
import { positionTimeline, lastTradeWindow, narrate } from '@strike/replay'
import { parseCommand, pcmToWav } from '@strike/voice-engine'
import { WalletAuth, WalletAuthError } from '@strike/wallet-auth'
import { AgentKeystore, NonceAllocator } from '@strike/signer'
import { RateLimiter, redact, randomId, stripControl } from '@strike/security'
import { validateStopPlacement } from '@strike/protection'
import { MainnetSigningBlockedError, HL_ENDPOINTS } from '@strike/shared'
import type { Hex } from 'viem'
import { WebSocket } from 'ws'
import { loadConfig, type ApiConfig } from './config'
import { BookFeed } from './services/bookfeed'
import { Store, type User } from './store'
import { PgPersistence } from './persistence'
import { MarketService } from './services/market'
import { getPortfolio } from './services/account'
import { confirm, preview, reconcile, placeStop, type TradeDeps } from './services/trade'
import { transcribe, sttHealth } from './services/stt'

export interface AppDeps { config?: Partial<ApiConfig>; fetchMainnet?: any; fetchTestnet?: any; fetchCoingecko?: any; now?: () => number; useWs?: boolean }

declare module 'fastify' { interface FastifyRequest { user?: User; sessionKind?: 'browser' | 'device' } }

class HttpError extends Error { constructor(readonly statusCode: number, msg: string, readonly code = 'ERROR') { super(msg) } }

export async function buildApp(deps: AppDeps = {}): Promise<{ app: FastifyInstance; store: Store; ms: MarketService; config: ApiConfig; keystore: AgentKeystore | null; confirmations: ConfirmationRegistry; persistence: PgPersistence | null }> {
  const config = { ...loadConfig(), ...deps.config }
  const now = deps.now ?? Date.now
  const mainnet = new InfoClient({ env: 'mainnet', fetch: deps.fetchMainnet })
  const testnet = new InfoClient({ env: 'testnet', fetch: deps.fetchTestnet })
  const cg = new CoinGeckoClient({ apiKey: config.coingeckoKey, fetch: deps.fetchCoingecko, clock: { now } })
  const ms = new MarketService(mainnet, testnet, cg, now)
  let wsMux: HlWsMultiplexer | null = null
  if (!config.offline && deps.useWs !== false) {
    wsMux = new HlWsMultiplexer('mainnet', (url) => new WebSocket(url) as any)
    wsMux.connect()
    ms.bookFeed = new BookFeed(wsMux, now)
  }
  const store = new Store(now)
  let persistence: PgPersistence | null = null, persistenceError: string | null = null
  if (config.databaseUrl) {
    try { persistence = await PgPersistence.connect(config.databaseUrl, store, now); await persistence.load(); persistence.start() }
    catch (e) { persistence = null; persistenceError = String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '[db-url]').slice(0, 200); console.warn('[strike] Postgres unavailable, falling back to in-memory store:', persistenceError) }
  }
  const confirmations = new ConfirmationRegistry(config.confirmSecret, now)
  const nonces = new NonceAllocator(now)
  const keystore = config.signerKek ? new AgentKeystore(config.signerKek) : null
  const walletAuth = new WalletAuth(new URL(config.publicOrigin).host, config.publicOrigin, now)
  const tradeDeps: TradeDeps = { ms, store, confirmations, nonces, now, testnetFetch: deps.fetchTestnet, signerFor: (id) => { if (!keystore) throw new HttpError(503, 'Testnet signer not configured (STRIKE_SIGNER_KEK)'); return keystore.signerFor(id) } }
  const limiter = new RateLimiter(120, 2, now) // per-IP general
  const guestLimiter = new RateLimiter(5, 5 / 60, now) // per-IP guest creation
  const pairLimiter = new RateLimiter(10, 10 / 60, now)

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn', redact: ['req.headers.authorization'] }, bodyLimit: 2 * 1024 * 1024, trustProxy: true })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: (o, cb) => cb(null, !o || config.allowedOrigins.includes(o)), credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE'] })

  app.addHook('onRequest', async (req, reply) => {
    if (!limiter.take(`ip:${req.ip}`)) return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many requests' })
    const h = req.headers.authorization
    const tok = h?.startsWith('Bearer ') ? h.slice(7) : undefined
    const r = store.resolve(tok)
    if (r) { req.user = r.user; req.sessionKind = r.session.kind }
  })
  // Write-through: any authenticated request may have mutated the user (ledger, receipts, devices, policy…).
  if (persistence) app.addHook('onResponse', async (req) => { if (req.user) store.touch(req.user.id) /* coalesced per flush tick */ })
  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : err instanceof ConfirmationError ? 409 : err instanceof ProposalError ? 422 : err instanceof WalletAuthError ? 401 : err instanceof MainnetSigningBlockedError ? 403 : err instanceof z.ZodError ? 400 : err.statusCode ?? (err.kind ? 502 : 500)
    const code = err.code ?? (err instanceof z.ZodError ? 'VALIDATION' : 'ERROR')
    reply.code(status).send({ error: code, message: redact(String(err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message)) })
  })
  const auth = (req: FastifyRequest): User => { if (!req.user) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED'); return req.user }
  const coinParam = z.object({ coin: z.string().regex(/^[A-Za-z0-9]{1,12}$/) })

  // ───────── health ─────────
  // Cheap liveness (no upstream calls) — used by Render health check and the keep-alive pinger.
  app.get('/healthz', async () => ({ ok: true, ts: now() }))
  app.get('/health', async () => ({ ok: true, ts: now() }))
  app.get('/readyz', async (_r, reply) => {
    try { const m = await ms.markets('mainnet'); return { ready: true, markets: m.snaps.length, marketTs: m.ts } } catch (e) { return reply.code(503).send({ ready: false, error: String((e as Error).message) }) }
  })

  // ───────── guest / sessions ─────────
  app.post('/v1/guest/session', async (req, reply) => {
    if (!guestLimiter.take(`g:${req.ip}`)) return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Guest creation limit reached' })
    store.cleanup(config.maxGuests - 1)
    const u = store.createUser('guest', config.guestTtlMs)
    const token = store.issueSession(u.id, 'browser', config.guestTtlMs)
    return { token, userId: u.id, mode: 'guest', expiresAt: u.expiresAt, labels: ['SIMULATED ACCOUNT', 'SIMULATED EXECUTION'] }
  })
  app.get('/v1/me', async (req) => { const u = auth(req); return { userId: u.id, mode: u.mode, address: u.address, accountEnv: u.accountEnv, expiresAt: u.expiresAt, watchlist: u.watchlist, signer: keystore?.info(u.id) ?? null, sessionKind: req.sessionKind } })
  app.post('/v1/auth/logout', async (req) => { const u = auth(req); store.revokeSessionsFor(u.id); store.audit(u, 'logout', 'all sessions revoked'); return { ok: true } })

  // ───────── wallet ownership (Mode C) ─────────
  app.post('/v1/auth/challenge', async (req) => {
    const b = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(req.body)
    const c = walletAuth.issue(b.address, 'testnet')
    return { challengeId: c.id, message: c.message, expiresAt: c.expiresAt }
  })
  app.post('/v1/auth/verify', async (req) => {
    const b = z.object({ challengeId: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(req.body)
    const origin = req.headers.origin ? new URL(req.headers.origin).host : ''
    const { address } = await walletAuth.verify(b.challengeId, b.signature as Hex, origin)
    const u = store.findWalletUser(address) ?? store.createUser('wallet', null, address)
    u.accountEnv = 'testnet'
    store.audit(u, 'wallet-verified', address)
    return { token: store.issueSession(u.id, 'browser', 12 * 3600e3), userId: u.id, address, mode: 'wallet' }
  })
  // ───────── watch-only (Mode B) ─────────
  app.post('/v1/accounts/watch', async (req) => {
    const b = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), env: z.enum(['mainnet', 'testnet']).default('mainnet') }).parse(req.body)
    const role = await (b.env === 'mainnet' ? mainnet : testnet).userRole(b.address).catch(() => null)
    if (role?.role === 'agent') throw new HttpError(422, `That address is an API wallet (agent) of ${role.data?.user ?? 'another account'}. Query the master account instead.`, 'AGENT_ADDRESS')
    const u = store.createUser('watch', 12 * 3600e3, b.address); u.accountEnv = b.env
    return { token: store.issueSession(u.id, 'browser', 12 * 3600e3), userId: u.id, mode: 'watch', address: b.address.toLowerCase(), env: b.env, role: role?.role ?? 'unknown', note: 'WATCH-ONLY: viewing an address does not imply control.' }
  })
  // ───────── API wallet (Mode D) ─────────
  app.post('/v1/signers/agent', async (req) => {
    const u = auth(req)
    if (u.mode !== 'wallet' || !u.address) throw new HttpError(403, 'Verify wallet ownership first')
    if (!keystore) throw new HttpError(503, 'Signer keystore not configured (STRIKE_SIGNER_KEK)', 'SIGNER_DISABLED')
    const { agentAddress } = keystore.create(u.id, u.address, 'strike', now())
    const nonce = now()
    const td = approveAgentTypedData(agentAddress, 'strike', nonce, 'testnet')
    store.audit(u, 'agent-created', agentAddress)
    return { agentAddress, typedData: { domain: td.domain, types: td.types, primaryType: td.primaryType, message: { ...td.message, nonce: String(nonce) } }, action: td.action, nonce, permissions: 'A Hyperliquid API wallet can place and cancel orders for your account. It cannot withdraw. STRIKE adds its own limits but cannot narrow what Hyperliquid allows the API wallet to do. Revoke it in the Hyperliquid testnet UI (API page) or by approving a new unnamed agent.' }
  })
  app.post('/v1/signers/agent/approve', async (req) => {
    const u = auth(req)
    const b = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), nonce: z.number().int() }).parse(req.body)
    if (!keystore) throw new HttpError(503, 'Signer keystore not configured', 'SIGNER_DISABLED')
    const info = keystore.info(u.id)
    if (!info || u.mode !== 'wallet') throw new HttpError(404, 'No pending API wallet')
    const td = approveAgentTypedData(info.agentAddress as Hex, info.agentName, b.nonce, 'testnet')
    const sig = b.signature
    const signature = { r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}`, v: Number.parseInt(sig.slice(130, 132), 16) }
    const f = (deps.fetchTestnet ?? fetch) as typeof fetch
    const res = await f(`${HL_ENDPOINTS.testnet.rest}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: td.action, nonce: b.nonce, signature }) })
    const body = await res.json().catch(() => null)
    const ok = (body as any)?.status === 'ok'
    if (ok) keystore.markApproved(u.id, now())
    store.audit(u, 'agent-approve', `${info.agentAddress} ok=${ok}`)
    return { ok, exchangeResponse: body, agentAddress: info.agentAddress }
  })

  // ───────── G2 pairing ─────────
  app.post('/v1/pairing/start', async (req) => {
    const u = auth(req)
    if (req.sessionKind !== 'browser') throw new HttpError(403, 'Pair from the companion')
    const code = String(Math.floor(100000 + Math.random() * 900000))
    store.pairing.set(code, { userId: u.id, expiresAt: now() + 5 * 60e3, attempts: 0 })
    return { code, expiresAt: now() + 5 * 60e3 }
  })
  app.post('/v1/pairing/claim', async (req, reply) => {
    if (!pairLimiter.take(`p:${req.ip}`)) return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many pairing attempts' })
    const b = z.object({ code: z.string().regex(/^\d{6}$/), deviceName: z.string().max(40).default('G2') }).parse(req.body)
    const p = store.pairing.get(b.code)
    if (!p || now() > p.expiresAt) throw new HttpError(401, 'Invalid or expired pairing code', 'PAIRING_INVALID')
    store.pairing.delete(b.code) // single use
    const id = randomId('dev_')
    store.devices.set(id, { id, userId: p.userId, name: b.deviceName, pairedAt: now(), revokedAt: null, lastSeen: null })
    return { token: store.issueSession(p.userId, 'device', 30 * 24 * 3600e3, id), deviceId: id }
  })
  app.get('/v1/devices', async (req) => { const u = auth(req); return [...store.devices.values()].filter((d) => d.userId === u.id) })
  app.delete('/v1/devices/:id', async (req) => {
    const u = auth(req); const { id } = z.object({ id: z.string() }).parse(req.params)
    const d = store.devices.get(id)
    if (!d || d.userId !== u.id) throw new HttpError(404, 'Not found') // no cross-user existence leak
    d.revokedAt = now(); return { ok: true }
  })

  // ───────── markets (shared public data) ─────────
  app.get('/v1/markets', async () => {
    const m = await ms.markets('mainnet')
    return { env: 'mainnet', label: m.stale ? 'STALE PUBLIC MARKET DATA' : 'LIVE PUBLIC MARKET DATA', ts: m.ts, markets: m.snaps.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm).map((s) => ({ ...s, mapping: ms.registry.byHlPerp(s.coin)?.coingeckoId ?? null })) }
  })
  app.get('/v1/markets/:coin', async (req) => {
    const { coin } = coinParam.parse(req.params)
    const m = await ms.markets('mainnet'); const s = m.snaps.find((x) => x.coin.toUpperCase() === coin.toUpperCase())
    if (!s) throw new HttpError(404, `Unknown market ${coin}`)
    const mapping = ms.registry.byHlPerp(s.coin)
    let research: unknown = null
    if (mapping?.coingeckoId) research = await cg.markets([mapping.coingeckoId]).then((r) => ({ ...r, data: r.data[0] ?? null, attribution: COINGECKO_ATTRIBUTION, note: 'CoinGecko aggregated price is research only — not an executable Hyperliquid price.' })).catch((e) => ({ error: String(e.message) }))
    return { snap: s, mapping, research }
  })
  app.get('/v1/markets/:coin/book', async (req) => { const { coin } = coinParam.parse(req.params); return ms.book(coin) })
  app.get('/v1/markets/:coin/candles', async (req) => {
    const { coin } = coinParam.parse(req.params)
    const q = z.object({ interval: z.enum(CANDLE_INTERVALS as [CandleInterval, ...CandleInterval[]]).default('1h'), n: z.coerce.number().int().min(10).max(500).default(96) }).parse(req.query)
    return { coin, interval: q.interval, candles: await ms.candles(coin, q.interval, q.n), source: 'hyperliquid-mainnet candleSnapshot' }
  })

  // ───────── intelligence ─────────
  app.get('/v1/radar', async (req) => {
    const q = z.object({ category: z.enum(['all', ...RADAR_CATEGORIES] as [string, ...string[]]).default('all') }).parse(req.query)
    const m = await ms.markets('mainnet')
    const tr = await ms.trendingPerps()
    let positions: string[] = []
    let watchlist: string[] = ['BTC', 'ETH', 'HYPE']
    if (req.user) { watchlist = req.user.watchlist; positions = (await getPortfolio(req.user, ms, now()).catch(() => null))?.positions.map((p) => p.coin) ?? [] }
    const r = buildRadar({ snaps: m.snaps, history: ms.history, positions, watchlist, trendingPerps: tr.list.filter((t) => t.status === 'verified' || t.status === 'candidate'), verifiedPerps: new Set(m.snaps.map((s) => s.coin).filter((c) => ms.registry.byHlPerp(c))), now: now() })
    const pts = q.category === 'all' ? r.points : r.byCategory[q.category as keyof typeof r.byCategory]
    return {
      category: q.category, ts: r.ts, marketTs: m.ts, config: r.config, observationStart: r.observationStart,
      encoding: { x: '24h % change, linear, clipped at ±2×mover threshold', y: 'percentile rank of 24h notional volume', size: 'percentile rank of OI notional', filled: 'your position', outlined: 'watchlist', warning: 'funding above threshold' },
      points: pts.slice(0, 40).map((p) => ({ coin: p.coin, x: p.x, y: p.y, size: p.size, isPosition: p.isPosition, isWatch: p.isWatch, warning: p.warning, score: p.score, reasons: p.reasons, explanation: explainRadar(p), mapping: p.mapping, markPx: p.snap.markPx, change24hPct: p.snap.change24hPct, fundingHourly: p.snap.fundingHourly, dayNtlVlm: p.snap.dayNtlVlm })),
      counts: Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, v.length])),
      trending: { items: tr.list, fetchedAt: tr.fetchedAt, stale: tr.stale, error: tr.error, attribution: COINGECKO_ATTRIBUTION },
      labels: [m.stale ? 'STALE PUBLIC MARKET DATA' : 'LIVE PUBLIC MARKET DATA'],
    }
  })
  app.get('/v1/market-dna/:coin', async (req) => {
    const { coin } = coinParam.parse(req.params)
    const m = await ms.markets('mainnet')
    const s = m.snaps.find((x) => x.coin.toUpperCase() === coin.toUpperCase()); if (!s) throw new HttpError(404, 'Unknown market')
    const universe = m.snaps.filter((x) => x.dayNtlVlm >= 1_000_000 || x.coin === s.coin)
    const candles = await ms.candles(s.coin, '1h', 48).catch(() => null)
    return { ...marketDna(s.coin, universe, candles ? candles.map((c) => Number(c.c)) : null, now()), label: 'LIVE PUBLIC MARKET DATA' }
  })
  app.get('/v1/liquidity-lens/:coin', async (req) => {
    const { coin } = coinParam.parse(req.params)
    const q = z.object({ side: z.enum(['buy', 'sell']).default('buy'), size: z.coerce.number().positive().max(10_000_000).optional() }).parse(req.query)
    const book = await ms.book(coin)
    const sizes = q.size ? [...new Set([...SIZE_PRESETS, q.size])].sort((a, b) => a - b) : [...SIZE_PRESETS]
    const l = liquidityLens(book, now(), sizes, q.side)
    return { ...l, bids: l.bids.slice(0, 20), asks: l.asks.slice(0, 20), note: 'Visible book snapshot only; it does not guarantee fills. Execution uses a fresh snapshot.' }
  })
  app.get('/v1/funding/:coin', async (req) => {
    const { coin } = coinParam.parse(req.params)
    const m = await ms.markets('mainnet'); const s = m.snaps.find((x) => x.coin.toUpperCase() === coin.toUpperCase()); if (!s) throw new HttpError(404, 'Unknown market')
    const hist = await ms.fundingHistory(s.coin, 48).catch(() => [])
    let szi: number | null = null
    let userFundings: Array<{ time: number; usdc: string; coin: string }> | undefined
    if (req.user) {
      const pf = await getPortfolio(req.user, ms, now()).catch(() => null)
      szi = pf?.positions.find((p) => p.coin === s.coin)?.szi ?? null
      if (req.user.address && req.user.mode !== 'guest') userFundings = (await (req.user.accountEnv === 'mainnet' ? mainnet : testnet).userFunding(req.user.address, now() - 7 * 86400e3).catch(() => [])).map((f) => ({ time: f.time, usdc: f.delta.usdc, coin: f.delta.coin }))
    }
    return { ...fundingClock({ coin: s.coin, rateHourly: s.fundingHourly, oraclePx: s.oraclePx, now: now(), szi, history: hist, userFundings, sessionStart: req.user?.createdAt }), intervalMs: FUNDING_INTERVAL_MS }
  })

  // ───────── portfolio / positions ─────────
  app.get('/v1/portfolio', async (req) => getPortfolio(auth(req), ms, now()))
  app.get('/v1/positions/:coin/orbit', async (req) => {
    const u = auth(req); const { coin } = coinParam.parse(req.params)
    const q = z.object({ scenarioPct: z.coerce.number().min(-90).max(500).optional() }).parse(req.query)
    const pf = await getPortfolio(u, ms, now())
    const p = pf.positions.find((x) => x.coin.toUpperCase() === coin.toUpperCase())
    if (!p) throw new HttpError(404, `No ${coin} position`)
    const ref = p.markPx ?? p.entryPx
    const scenarioPx = q.scenarioPct != null ? ref * (1 + q.scenarioPct / 100) : null
    return { position: p, scenario: scenarioPx == null ? null : { pct: q.scenarioPct, px: scenarioPx, pnlChangeUsd: p.szi * (scenarioPx - ref), note: 'Hypothetical move, not a forecast.' }, labels: pf.labels }
  })

  // ───────── simulation ─────────
  const shadowBody = z.object({ coin: z.string(), side: z.enum(['long', 'short']), action: z.enum(['open', 'increase', 'reduce']).default('open'), notionalUsd: z.number().positive().max(1_000_000), leverage: z.number().min(1).max(50) })
  app.post('/v1/shadow-trade', async (req) => {
    const b = shadowBody.parse(req.body)
    const m = await ms.markets('mainnet'); const s = m.snaps.find((x) => x.coin.toUpperCase() === b.coin.toUpperCase()); if (!s) throw new HttpError(404, 'Unknown market')
    const book = await ms.book(s.coin).catch(() => null)
    const pf = req.user ? await getPortfolio(req.user, ms, now()).catch(() => null) : null
    const ex = pf?.positions.find((p) => p.coin === s.coin)
    const r = shadowTrade({ ...b, coin: s.coin, markPx: s.markPx, oraclePx: s.oraclePx, fundingHourly: s.fundingHourly, szDecimals: s.szDecimals, book, now: now(), existing: ex ? { szi: ex.szi, entryPx: ex.entryPx } : null, otherExposureUsd: pf?.positions.filter((p) => p.coin !== s.coin).reduce((a, p) => a + (p.notionalUsd ?? 0), 0) ?? 0, accountValueUsd: pf?.accountValue ?? null, riskBudgetUsd: req.user?.policy.riskBudgetUsd ?? 500 })
    return { ...r, maxLeverage: s.maxLeverage, leverageWarning: b.leverage > s.maxLeverage ? `Exchange max leverage for ${s.coin} is ${s.maxLeverage}x` : null }
  })
  app.post('/v1/risk/scenarios', async (req) => {
    const u = auth(req); const b = z.object({ pcts: z.array(z.number().min(-90).max(500)).max(20).default([...SCENARIOS_PCT]) }).parse(req.body ?? {})
    const pf = await getPortfolio(u, ms, now())
    return { scenarios: b.pcts.map((pct) => ({ pct, perPosition: pf.positions.map((p) => ({ coin: p.coin, pnlChangeUsd: p.szi * (p.markPx ?? p.entryPx) * (pct / 100) })), totalUsd: pf.positions.reduce((a, p) => a + p.szi * (p.markPx ?? p.entryPx) * (pct / 100), 0) })), assumption: 'Uniform % move applied to every position from current mark; not a forecast; cross-asset correlation not modelled.' }
  })
  app.get('/v1/risk/policy', async (req) => auth(req).policy)
  app.put('/v1/risk/policy', async (req) => {
    const u = auth(req)
    const b = z.object({ maxOrderNotionalUsd: z.number().positive().max(100_000), maxLeverage: z.number().min(1).max(50), maxPositionExposureUsd: z.number().positive(), maxTotalExposureUsd: z.number().positive(), maxConcentrationPct: z.number().min(1).max(100), maxMarginUtilizationPct: z.number().min(1).max(100), minAvailableCollateralUsd: z.number().min(0), maxSlippageBps: z.number().min(1).max(1000), allowedAssets: z.array(z.string()).nullable(), blockedAssets: z.array(z.string()), maxOpenOrders: z.number().int().min(1).max(200), sessionBudgetUsd: z.number().positive(), riskBudgetUsd: z.number().positive() }).partial().parse(req.body)
    u.policy = { ...u.policy, ...b }; store.audit(u, 'policy', JSON.stringify(b)); return u.policy
  })

  // ───────── trading ─────────
  const intentBody = z.object({ coin: z.string().regex(/^[A-Za-z0-9]{1,12}$/), kind: z.literal('perp').default('perp'), side: z.enum(['buy', 'sell']), notionalUsd: z.number().positive().optional(), size: z.number().positive().optional(), fractionOfPosition: z.number().gt(0).max(1).optional(), orderType: z.enum(['ioc-bounded', 'limit-gtc', 'limit-alo']).default('ioc-bounded'), limitPx: z.number().positive().optional(), maxSlippageBps: z.number().min(1).max(500).default(30), leverage: z.number().min(1).max(50).default(1), reduceOnly: z.boolean().default(false), protection: z.object({ stopPx: z.number().positive().optional(), takeProfitPx: z.number().positive().optional() }).optional(), cgId: z.string().optional() })
  app.post('/v1/trade/preview', async (req) => {
    const u = auth(req)
    const { cgId, ...intent } = intentBody.parse(req.body)
    return preview(tradeDeps, u, intent, cgId)
  })
  app.post('/v1/trade/confirm', async (req) => {
    const u = auth(req)
    const b = z.object({ proposalId: z.string(), confirmToken: z.string() }).parse(req.body)
    return confirm(tradeDeps, u, b.proposalId, b.confirmToken)
  })
  app.post('/v1/trade/cancel-preview', async (req) => { const u = auth(req); const b = z.object({ proposalId: z.string() }).parse(req.body); return { canceled: confirmations.cancel(b.proposalId, u.id) } })
  app.get('/v1/receipts', async (req) => auth(req).receipts.slice().reverse())
  app.post('/v1/receipts/:id/reconcile', async (req) => {
    const u = auth(req); const { id } = z.object({ id: z.string() }).parse(req.params)
    const r = u.receipts.find((x) => x.id === id); if (!r) throw new HttpError(404, 'Not found')
    return reconcile(tradeDeps, u, r)
  })
  app.get('/v1/orders', async (req) => { const pf = await getPortfolio(auth(req), ms, now()); return { openOrders: pf.openOrders, env: pf.env } })

  // ───────── protection ─────────
  app.get('/v1/protection/status', async (req) => { const pf = await getPortfolio(auth(req), ms, now()); return pf.positions.map((p) => ({ coin: p.coin, side: p.side, size: p.size, ...p.protection })) })
  app.post('/v1/protection/stop', async (req) => {
    const u = auth(req)
    const b = z.object({ coin: z.string(), stopPx: z.number().positive() }).parse(req.body)
    const pf = await getPortfolio(u, ms, now())
    const p = pf.positions.find((x) => x.coin.toUpperCase() === b.coin.toUpperCase()); if (!p) throw new HttpError(404, 'No position')
    const bad = validateStopPlacement(p.side, p.markPx ?? p.entryPx, b.stopPx); if (bad) throw new HttpError(422, bad, 'BAD_STOP')
    if (p.protection.state === 'PROTECTED') throw new HttpError(409, 'Position already has a verified stop — cancel it first to avoid duplicates', 'DUPLICATE_PROTECTION')
    if (u.mode === 'guest') { u.ledger!.setProtection(p.coin, b.stopPx, p.takeProfitPx); u.protectionLog.push({ t: now(), coin: p.coin, ok: true, detail: `Simulated stop ${b.stopPx}` }); return { label: 'SIMULATED EXECUTION', verified: (await getPortfolio(u, ms, now())).positions.find((x) => x.coin === p.coin)?.protection } }
    if (u.mode !== 'wallet') throw new HttpError(403, 'Watch-only')
    return { label: 'TESTNET EXECUTION', ...(await placeStop(tradeDeps, u, { instrument: { coin: p.coin, kind: 'perp', assetId: -1 } }, p.szi, b.stopPx)) }
  })

  // ───────── sentinel ─────────
  app.get('/v1/sentinel/events', async (req) => {
    const u = auth(req)
    const pf = await getPortfolio(u, ms, now())
    const positions = pf.positions.map((p) => ({ coin: p.coin, szi: p.szi, markPx: p.markPx, liquidationPx: p.liquidationPx, unrealizedPnl: p.unrealizedPnl ?? 0, marginUsed: p.marginUsed, fundingHourly: p.fundingHourly, protection: p.protection.state }))
    const cur = evaluateSentinel({ account: pf.account ?? u.id, now: now(), dataTs: pf.dataTs, wsConnected: null, accountValue: pf.accountValue, totalMarginUsed: pf.totalMarginUsed, positions, prevPositions: u.lastPositions })
    u.lastPositions = positions
    return { events: u.sentinel.update(cur, now()), note: 'G2 alerts only appear while STRIKE is open on the glasses. Sentinel never trades automatically.' }
  })

  // ───────── replay ─────────
  app.get('/v1/replay/market', async (req) => {
    const q = z.object({ coin: z.string(), interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'), n: z.coerce.number().int().min(10).max(300).default(72) }).parse(req.query)
    return { coin: q.coin, interval: q.interval, candles: await ms.candles(q.coin, q.interval, q.n), source: 'hyperliquid-mainnet candleSnapshot' }
  })
  app.get('/v1/replay/position', async (req) => {
    const u = auth(req); const q = z.object({ coin: z.string(), scope: z.enum(['position', 'last-trade']).default('position') }).parse(req.query)
    let fills: any[] = [], fundings: any[] = []
    if (u.mode === 'guest') fills = u.ledger!.fills.filter((f) => f.coin === q.coin).map((f) => ({ coin: f.coin, px: String(f.px), sz: String(f.sz), side: f.side === 'buy' ? 'B' : 'A', time: f.time, startPosition: '0', dir: f.side, closedPnl: String(f.closedPnl), oid: 0, fee: f.fee.toFixed(4) }))
    else if (u.address) { const info = u.accountEnv === 'mainnet' ? mainnet : testnet; [fills, fundings] = await Promise.all([info.userFills(u.address), info.userFunding(u.address, now() - 30 * 86400e3)]) }
    if (u.mode === 'guest') { let pos = 0; for (const f of fills) { f.startPosition = String(pos); pos += f.side === 'B' ? Number(f.sz) : -Number(f.sz) } }
    const t = positionTimeline(q.coin, fills, fundings, u.protectionLog)
    const events = q.scope === 'last-trade' ? lastTradeWindow(t.events) : t.events
    return { ...t, events, narrative: events.map(narrate), note: u.mode === 'guest' ? 'Simulated session fills only (illustrative seed positions have no fill history).' : t.note }
  })

  // ───────── voice ─────────
  app.post('/v1/voice/command', async (req) => {
    const u = auth(req)
    const b = z.object({ text: z.string().min(1).max(300), source: z.enum(['typed', 'test', 'stt', 'browser-stt']).default('typed'), context: z.object({ coin: z.string().nullable().default(null), screen: z.string().default('radar') }).default({ coin: null, screen: 'radar' }), confidence: z.number().nullable().optional() }).parse(req.body)
    const m = await ms.markets('mainnet').catch(() => null)
    const pf = await getPortfolio(u, ms, now()).catch(() => null)
    const text = stripControl(b.text, 300)
    const intent = parseCommand(text, { coin: b.context.coin, screen: b.context.screen, positions: pf?.positions.map((p) => p.coin) ?? [], lastIntent: null, knownCoins: m?.snaps.map((s) => s.coin) ?? ['BTC', 'ETH', 'SOL', 'HYPE'] })
    u.voice.push({ t: now(), transcript: text, source: b.source, intent, confidence: b.confidence ?? null }); if (u.voice.length > 100) u.voice.shift()
    return { intent, transcript: text, source: b.source, note: intent.type === 'confirm-refused' ? 'Voice cannot authorise execution. Use the dedicated confirmation screen.' : null }
  })
  app.post('/v1/voice/transcribe', async (req) => {
    const u = auth(req)
    const b = z.object({ pcmBase64: z.string().max(1_400_000), sampleRate: z.literal(16000).default(16000) }).parse(req.body)
    const pcm = Buffer.from(b.pcmBase64, 'base64')
    if (pcm.length < 3200) throw new HttpError(422, 'Audio too short', 'AUDIO_TOO_SHORT')
    const r = await transcribe(config, pcmToWav(new Uint8Array(pcm)))
    store.audit(u, 'stt', `${pcm.length}B → ${r.provider}`)
    return r // raw audio is NOT stored
  })
  app.get('/v1/voice/history', async (req) => auth(req).voice.slice().reverse())

  // ───────── diagnostics ─────────
  app.get('/v1/diagnostics', async () => ({
    ts: now(), coingecko: cg.usage(), hyperliquid: { ...ms.upstream, ws: wsMux?.getStatus() ?? null, bookFeed: ms.bookFeed?.stats ?? null, cacheEntries: ms.cache.size(), mainnet: HL_ENDPOINTS.mainnet.rest, testnet: HL_ENDPOINTS.testnet.rest, signing: 'testnet-only (mainnet blocked in code)' },
    persistence: persistence ? { mode: 'postgres', ...persistence.stats } : { mode: 'memory', note: config.databaseUrl ? `DATABASE_URL set but unavailable: ${persistenceError}` : 'DATABASE_URL not set — state resets on restart' },
    stt: await sttHealth(config), sessions: { users: store.users.size, guests: store.guestCount(), sessions: store.sessions.size, maxGuests: config.maxGuests, guestTtlMs: config.guestTtlMs },
    signer: { configured: !!keystore }, observationStart: ms.history.observationStart(),
  }))

  const timer = setInterval(() => { store.cleanup(config.maxGuests); confirmations.purgeExpired() }, 60_000)
  app.addHook('onClose', async () => { clearInterval(timer); ms.bookFeed?.close(); wsMux?.close(); await persistence?.close() })
  return { app, store, ms, config, keystore, confirmations, persistence }
}
