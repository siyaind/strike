/**
 * Key-gated LIVE tests against the real CoinGecko Demo API. Skipped when COINGECKO_DEMO_API_KEY is unset (e.g. CI).
 * The key is read from the environment and never logged or written to evidence.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { CoinGeckoClient, COINGECKO_ATTRIBUTION } from '../../packages/coingecko/src/index'
import { VERIFIED } from '../../packages/asset-registry/src/index'

const KEY = process.env.COINGECKO_DEMO_API_KEY
const results: Array<{ name: string; ok: boolean; detail: unknown }> = []
const rec = (name: string, ok: boolean, detail: unknown) => results.push({ name, ok, detail })

describe.skipIf(!KEY)('CoinGecko Demo API (live, key-gated)', () => {
  const cg = new CoinGeckoClient({ apiKey: KEY })
  afterAll(() => {
    mkdirSync('evidence/deployment', { recursive: true })
    const u = cg.usage()
    writeFileSync('evidence/deployment/coingecko-demo-live.json', JSON.stringify({ at: new Date().toISOString(), mode: u.mode, usage: { ...u }, results }, null, 2))
  })
  it('uses demo mode with the documented header and STRIKE self-limit', () => {
    expect(cg.mode).toBe('demo'); expect(cg.usage().perMinute).toBe(60); expect(cg.usage().monthlyBudget).toBe(10_000)
    rec('mode', true, { mode: cg.mode, perMinute: cg.usage().perMinute })
  })
  it('raw key check: /ping with x-cg-demo-api-key → 200', async () => {
    const r = await fetch('https://api.coingecko.com/api/v3/ping', { headers: { 'x-cg-demo-api-key': KEY! } })
    rec('ping', r.status === 200, { status: r.status, body: await r.json() })
    expect(r.status).toBe(200)
  })
  it('trending returns coins', async () => {
    const r = await cg.trending()
    rec('trending', r.data.coins.length > 0, { count: r.data.coins.length, top: r.data.coins.slice(0, 5).map((c) => c.item.id) })
    expect(r.data.coins.length).toBeGreaterThan(0)
  })
  it('second trending call is served from the shared cache (no extra credit)', async () => {
    const before = cg.usage().callsThisMonth
    await cg.trending()
    rec('cache', cg.usage().callsThisMonth === before, { callsBefore: before, callsAfter: cg.usage().callsThisMonth })
    expect(cg.usage().callsThisMonth).toBe(before)
  })
  it('one batched markets call verifies every VERIFIED mapping (symbol matches the Hyperliquid base)', async () => {
    const r = await cg.markets(VERIFIED.map((m) => m.coingeckoId!).filter(Boolean))
    const byId = new Map(r.data.map((x) => [x.id, x]))
    const rows = VERIFIED.map((m) => { const c = byId.get(m.coingeckoId!); return { cgId: m.coingeckoId, hl: m.hlPerp ?? m.symbol, sym: m.symbol, name: m.name, cgSymbol: c?.symbol ?? null, cgName: c?.name ?? null, found: !!c } })
    const missing = rows.filter((x) => !x.found)
    // A documented CoinGecko rebrand (e.g. 'Gram (prev. Toncoin)') keeps the same coin id; anything else is a mapping failure.
    const rebrands = rows.filter((x) => x.found && String(x.cgSymbol).toLowerCase() !== x.sym.toLowerCase() && String(x.cgName).includes(`prev. ${x.name}`))
    const mismatches = rows.filter((x) => x.found && String(x.cgSymbol).toLowerCase() !== x.sym.toLowerCase() && !rebrands.includes(x))
    rec('verified-mappings', missing.length === 0 && mismatches.length === 0, { checked: rows.length, missing, mismatches, rebrands })
    expect(missing).toEqual([])
    expect(mismatches).toEqual([])
  })
  it('global + categories + coin + search', async () => {
    const g = await cg.global(); const cats = await cg.categories(); const btc = await cg.coin('bitcoin'); const s = await cg.search('hyperliquid')
    rec('global', (g.data.data.total_market_cap.usd ?? 0) > 0, { mcapUsd: Math.round(g.data.data.total_market_cap.usd ?? 0) })
    rec('categories', cats.data.length > 10, { count: cats.data.length })
    rec('coin', btc.data.symbol === 'btc', { id: btc.data.id })
    rec('search', s.data.coins.some((c) => c.id === 'hyperliquid'), { first: s.data.coins[0]?.id })
    expect(g.data.data.total_market_cap.usd ?? 0).toBeGreaterThan(0); expect(btc.data.symbol).toBe('btc'); expect(s.data.coins.some((c) => c.id === 'hyperliquid')).toBe(true)
  })
  it('market chart (7d) has points', async () => {
    const c = await cg.marketChart('bitcoin', 7)
    rec('marketChart', c.data.prices.length > 50, { points: c.data.prices.length }); expect(c.data.prices.length).toBeGreaterThan(50)
  })
  it('attribution present', () => { expect(COINGECKO_ATTRIBUTION.url).toMatch(/coingecko\.com/); rec('attribution', true, COINGECKO_ATTRIBUTION) })
})
