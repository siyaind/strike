#!/usr/bin/env node
// Production smoke test against the live API + companion. Writes evidence/deployment/api-smoke.json. Never prints secrets.
import { mkdirSync, writeFileSync } from 'node:fs'
const API = process.env.SMOKE_API ?? 'https://strike-g2-api.onrender.com'
const WEB = process.env.SMOKE_WEB ?? 'https://strike-g2.vercel.app'
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? '✓' : '✗', name, JSON.stringify(detail).slice(0, 160)) }
async function j(path, init = {}, tok) {
  const t0 = Date.now()
  const r = await fetch(API + path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}), origin: WEB, ...(init.headers ?? {}) } })
  const body = await r.json().catch(() => null)
  return { status: r.status, body, ms: Date.now() - t0, headers: r.headers }
}
const h = await j('/healthz'); check('healthz', h.status === 200 && h.body.ok, { status: h.status, ms: h.ms })
const rd = await j('/readyz'); check('readyz (live HL meta)', rd.status === 200 && rd.body.ready && rd.body.markets > 100, { markets: rd.body?.markets, ageMs: Date.now() - rd.body?.marketTs })
const g = await j('/v1/guest/session', { method: 'POST' }); const tok = g.body?.token
check('guest session', g.status === 200 && tok && g.body.mode === 'guest', { status: g.status, labels: g.body?.labels })
const pf = await j('/v1/portfolio', {}, tok); check('guest portfolio SIMULATED', pf.body?.env === 'simulated' && pf.body.positions.length === 3, { labels: pf.body?.labels, coins: pf.body?.positions?.map((p) => p.coin) })
const rad = await j('/v1/radar', {}, tok)
check('radar live data', rad.status === 200 && rad.body.points.length > 10 && Date.now() - rad.body.marketTs < 60_000, { points: rad.body?.points?.length, marketAgeMs: Date.now() - rad.body?.marketTs, top: rad.body?.points?.slice(0, 3).map((p) => p.coin) })
check('radar CoinGecko trending (Demo key on server)', !rad.body?.trending?.error && rad.body?.trending?.items?.length > 0, { error: rad.body?.trending?.error, items: rad.body?.trending?.items?.length, attribution: rad.body?.trending?.attribution?.text })
const dna = await j('/v1/market-dna/BTC'); check('market DNA BTC', dna.body?.axes?.length === 6, { narrative: dna.body?.narrative?.slice(0, 100) })
const lens = await j('/v1/liquidity-lens/BTC?size=250'); check('liquidity lens BTC', lens.body?.mid > 0 && lens.body.ageMs < 15_000, { mid: lens.body?.mid, spreadBps: lens.body?.spreadBps, ageMs: lens.body?.ageMs })
const fund = await j('/v1/funding/ETH'); check('funding clock ETH', fund.body?.intervalMs === 3600000, { rateHourly: fund.body?.rateHourly, msToNext: fund.body?.msToNext })
const orb = await j('/v1/positions/ETH/orbit?scenarioPct=-5', {}, tok); check('position orbit ETH', orb.body?.scenario?.pct === -5, { protection: orb.body?.position?.protection?.state, pnl: orb.body?.scenario?.pnlChangeUsd })
const sh = await j('/v1/shadow-trade', { method: 'POST', body: JSON.stringify({ coin: 'SOL', side: 'long', notionalUsd: 100, leverage: 2 }) }, tok); check('shadow trade SOL', sh.body?.scenarios?.length === 7, { estEntryPx: sh.body?.estEntryPx, labels: sh.body?.labels })
const pv = await j('/v1/trade/preview', { method: 'POST', body: JSON.stringify({ coin: 'BTC', side: 'buy', notionalUsd: 50, leverage: 2 }) }, tok)
check('trade preview (simulated)', pv.body?.label === 'SIMULATED EXECUTION' && pv.body.proposal.risk.ok, { risk: pv.body?.proposal?.risk?.ok, price: pv.body?.proposal?.priceConstraint })
const cf = await j('/v1/trade/confirm', { method: 'POST', body: JSON.stringify({ proposalId: pv.body?.proposal?.proposalId, confirmToken: pv.body?.confirmToken }) }, tok)
check('confirm → simulated receipt', ['FILLED', 'PARTIALLY_FILLED'].includes(cf.body?.status) && cf.body?.env === 'simulated', { status: cf.body?.status, label: cf.body?.label, avgPx: cf.body?.avgPx })
const cf2 = await j('/v1/trade/confirm', { method: 'POST', body: JSON.stringify({ proposalId: pv.body?.proposal?.proposalId, confirmToken: pv.body?.confirmToken }) }, tok)
check('duplicate confirm rejected', cf2.status === 409 && cf2.body?.error === 'REPLAYED', { status: cf2.status, error: cf2.body?.error })
const g2 = await j('/v1/guest/session', { method: 'POST' })
const cross = await j('/v1/trade/confirm', { method: 'POST', body: JSON.stringify({ proposalId: pv.body?.proposal?.proposalId, confirmToken: pv.body?.confirmToken }) }, g2.body?.token)
check('cross-user confirm rejected', cross.status >= 400, { status: cross.status, error: cross.body?.error })
const v = await j('/v1/voice/command', { method: 'POST', body: JSON.stringify({ text: 'confirm the order' }) }, tok); check('voice cannot confirm', v.body?.intent?.type === 'confirm-refused', v.body?.intent)
const sig = await j('/v1/signers/agent', { method: 'POST' }, tok); check('agent signer disabled in public deploy', sig.status >= 400, { status: sig.status, error: sig.body?.error })
const un = await j('/v1/portfolio'); check('unauthenticated → 401', un.status === 401, { status: un.status })
const bad = await fetch(API + '/healthz', { headers: { origin: 'https://evil.example' } }); check('CORS denies other origins', !bad.headers.get('access-control-allow-origin'), { acao: bad.headers.get('access-control-allow-origin') })
const ok = await fetch(API + '/healthz', { headers: { origin: WEB } }); check('CORS allows companion origin', ok.headers.get('access-control-allow-origin') === WEB, { acao: ok.headers.get('access-control-allow-origin') })
const dg = await j('/v1/diagnostics'); const dgs = JSON.stringify(dg.body)
check('diagnostics: CoinGecko demo mode, testnet-only signing, no secrets', dg.body?.coingecko?.mode === 'demo' && /testnet-only/.test(dg.body?.hyperliquid?.signing) && !/CG-|x-cg-demo/i.test(dgs) && (!process.env.COINGECKO_DEMO_API_KEY || !dgs.includes(process.env.COINGECKO_DEMO_API_KEY)), { cg: dg.body?.coingecko?.mode, calls: dg.body?.coingecko?.callsThisMonth, signing: dg.body?.hyperliquid?.signing, signer: dg.body?.signer, stt: dg.body?.stt })
const web = await fetch(WEB + '/'); const html = await web.text(); check('companion landing public (no SSO wall)', web.status === 200 && html.includes('Read the market') && !/vercel\.com\/sso|Authentication Required/i.test(html), { status: web.status })
for (const p of ['/demo', '/radar', '/asset/BTC', '/positions', '/risk', '/replay', '/sentinel', '/voice', '/devices', '/wallet', '/diagnostics']) { const r = await fetch(WEB + p); check(`companion ${p}`, r.status === 200, { status: r.status }) }
const hdr = (await fetch(WEB + '/')).headers; check('companion security headers', hdr.get('x-frame-options') === 'DENY' && hdr.get('x-content-type-options') === 'nosniff', { xfo: hdr.get('x-frame-options') })
const out = { at: new Date().toISOString(), api: API, web: WEB, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks }
mkdirSync('evidence/deployment', { recursive: true }); writeFileSync('evidence/deployment/api-smoke.json', JSON.stringify(out, null, 2))
console.log(`\n${out.passed} passed, ${out.failed} failed`); process.exit(out.failed ? 1 : 0)
