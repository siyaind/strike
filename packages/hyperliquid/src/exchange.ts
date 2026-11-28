import type { LocalAccount } from 'viem'
import { assertSigningAllowed, HL_ENDPOINTS, type HlEnv } from '@strike/shared'
import { signL1Action, type Signature } from './signing'
import { parseExchangeResponse, type ParsedExchangeResponse } from './responses'
import type { FetchLike } from './info'

export type Tif = 'Alo' | 'Ioc' | 'Gtc'
export interface OrderWire {
  a: number; b: boolean; p: string; s: string; r: boolean
  t: { limit: { tif: Tif } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } }
  c?: string
}

/** Key order matters for msgpack hashing — mirrors python SDK `order_request_to_order_wire`. */
export function orderWire(o: { asset: number; isBuy: boolean; px: string; sz: string; reduceOnly: boolean; type: OrderWire['t']; cloid?: string }): OrderWire {
  const t = 'limit' in o.type ? { limit: { tif: o.type.limit.tif } } : { trigger: { isMarket: o.type.trigger.isMarket, triggerPx: o.type.trigger.triggerPx, tpsl: o.type.trigger.tpsl } }
  const w: OrderWire = { a: o.asset, b: o.isBuy, p: o.px, s: o.sz, r: o.reduceOnly, t }
  if (o.cloid) w.c = o.cloid
  return w
}

export function orderAction(orders: OrderWire[], grouping: 'na' | 'normalTpsl' | 'positionTpsl' = 'na') {
  // NOTE: no `builder` field — STRIKE never attaches builder fees.
  return { type: 'order', orders, grouping }
}
export function cancelAction(cancels: Array<{ a: number; o: number }>) { return { type: 'cancel', cancels } }
export function updateLeverageAction(asset: number, isCross: boolean, leverage: number) { return { type: 'updateLeverage', asset, isCross, leverage } }

/** Server-side allowlist. Anything that moves funds (withdraw3, usdSend, spotSend, usdClassTransfer, vaultTransfer, sendAsset, ...) is rejected. */
export const ALLOWED_ACTION_TYPES = new Set(['order', 'cancel', 'cancelByCloid', 'updateLeverage', 'modify', 'batchModify'])

export class ActionNotAllowedError extends Error { readonly code = 'ACTION_NOT_ALLOWED' }

export interface NonceSource { next(signer: string): number }

export interface ExchangeResult { request: { action: unknown; nonce: number; vaultAddress: string | null }; parsed: ParsedExchangeResponse; raw: unknown; httpStatus: number }

/** Testnet-only signed client. Constructing it with mainnet throws. */
export class TestnetExchangeClient {
  readonly env: HlEnv
  private readonly url: string
  private readonly f: FetchLike
  constructor(private readonly signer: LocalAccount, private readonly nonces: NonceSource, opts: { env: HlEnv; fetch?: FetchLike; vaultAddress?: string | null; baseUrl?: string }) {
    assertSigningAllowed(opts.env, 'TestnetExchangeClient')
    this.env = opts.env
    this.url = `${opts.baseUrl ?? HL_ENDPOINTS.testnet.rest}/exchange`
    if (this.url.includes('api.hyperliquid.xyz')) throw new Error('Refusing mainnet exchange URL')
    this.f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.vaultAddress = opts.vaultAddress ?? null
  }
  private readonly vaultAddress: string | null

  get signerAddress() { return this.signer.address }

  async submit(action: { type: string } & Record<string, unknown>): Promise<ExchangeResult> {
    if (!ALLOWED_ACTION_TYPES.has(action.type)) throw new ActionNotAllowedError(`Action '${action.type}' is not in the STRIKE allowlist`)
    if ('builder' in action) throw new ActionNotAllowedError('Builder fees are not permitted')
    const nonce = this.nonces.next(this.signer.address)
    const signature: Signature = await signL1Action(this.signer, action, nonce, this.env, this.vaultAddress)
    const body: Record<string, unknown> = { action, nonce, signature }
    if (this.vaultAddress) body.vaultAddress = this.vaultAddress
    const res = await this.f(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    let raw: unknown
    try { raw = await res.json() } catch { raw = null }
    return { request: { action, nonce, vaultAddress: this.vaultAddress }, parsed: parseExchangeResponse(raw), raw, httpStatus: res.status }
  }
}
