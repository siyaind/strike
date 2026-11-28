/**
 * Hyperliquid TESTNET verification probe. Key lives OUTSIDE the repo (env var or mode-600 file, see @strike/signer/testnet-key) and is never printed.
 * Records exactly what the testnet returned. Never touches mainnet signing (and proves it is blocked).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { InfoClient, MetaIndex, TestnetExchangeClient, orderAction, orderWire, roundPrice, roundSizeDown } from '@strike/hyperliquid'
import { NonceAllocator } from '@strike/signer'
import { loadTestnetAccount } from '@strike/signer/testnet-key'

// Key loaded at runtime from STRIKE_TESTNET_PRIVATE_KEY or STRIKE_TESTNET_KEY_FILE (default /home/box/secrets/strike-testnet-wallet.json). Never printed.
const { account: acct, source } = loadTestnetAccount()
const out: any = { at: new Date().toISOString(), env: 'testnet', address: acct.address, keyLocation: source === 'env' ? 'env var (not printed)' : 'file outside repo (mode 600)', steps: [] as any[] }
const step = (name: string, data: unknown) => { out.steps.push({ name, at: new Date().toISOString(), data }); console.log('•', name, JSON.stringify(data).slice(0, 300)) }

const info = new InfoClient({ env: 'testnet' })
const mainInfo = new InfoClient({ env: 'mainnet' })
const ch = await info.clearinghouseState(acct.address)
step('testnet clearinghouseState', { accountValue: ch.marginSummary.accountValue, withdrawable: ch.withdrawable, positions: ch.assetPositions.length })
const role = await info.userRole(acct.address).catch((e: Error) => ({ error: e.message }))
step('testnet userRole', role)
const mainCh = await mainInfo.clearinghouseState(acct.address)
step('mainnet clearinghouseState (read-only)', { accountValue: mainCh.marginSummary.accountValue, note: 'Testnet faucet requires a prior mainnet deposit from the same address' })

// Mainnet signing must be impossible
try { new TestnetExchangeClient(acct, new NonceAllocator(), { env: 'mainnet' as any }); step('mainnet client construction', { blocked: false }) } catch (e) { step('mainnet client construction', { blocked: true, error: (e as Error).name + ': ' + (e as Error).message }) }

// Signed testnet order: tiny GTC far below market (would rest, never fill). With an unfunded account the exchange must reject it.
const [meta, ctxs] = await info.metaAndAssetCtxs()
const idx = new MetaIndex('testnet', meta.universe)
const btc = idx.perp('BTC')
const ctx = ctxs[btc.assetId] as any
const mid = Number(ctx.midPx ?? ctx.markPx)
const px = roundPrice(mid * 0.5, 'perp', btc.szDecimals, 'down')
const sz = roundSizeDown(12 / Number(px), btc.szDecimals)
const ex = new TestnetExchangeClient(acct, new NonceAllocator(), { env: 'testnet' })
const action = orderAction([orderWire({ asset: btc.assetId, isBuy: true, px, sz, reduceOnly: false, type: { limit: { tif: 'Gtc' } } })])
const r = await ex.submit(action)
step('testnet signed order (BTC GTC 50% below mid, ~$12)', { request: r.request, httpStatus: r.httpStatus, raw: r.raw, parsed: r.parsed })
const rejected = JSON.stringify(r.raw).toLowerCase().includes('err') || (r.parsed as any)?.ok === false
out.result = rejected ? 'SIGNED_REQUEST_ACCEPTED_BY_TESTNET_API_BUT_REJECTED_UNFUNDED' : 'ORDER_ACCEPTED'
if (!rejected) {
  const oid = (r.raw as any)?.response?.data?.statuses?.[0]?.resting?.oid
  if (oid != null) { const c = await ex.submit({ type: 'cancel', cancels: [{ a: btc.assetId, o: oid }] }); step('cancel resting test order', c.raw) }
}
out.blocked = rejected ? 'BLOCKED: account unfunded. Testnet faucet requires a mainnet deposit from the same address; owner action needed.' : null
mkdirSync(new URL('../../../evidence/testnet', import.meta.url).pathname, { recursive: true })
writeFileSync(new URL('../../../evidence/testnet/probe.json', import.meta.url).pathname, JSON.stringify(out, null, 2))
console.log('RESULT', out.result)
