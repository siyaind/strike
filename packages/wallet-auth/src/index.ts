import { verifyMessage, type Hex } from 'viem'
import { randomId } from '@strike/security'

/** EIP-4361-style (SIWE-shaped) ownership challenge. Domain-bound, nonce-bound, expiring, single-use. */
export interface Challenge { id: string; address: string; domain: string; uri: string; nonce: string; env: 'testnet' | 'mainnet-readonly'; issuedAt: number; expiresAt: number; message: string; used: boolean }

export class WalletAuthError extends Error { constructor(readonly code: 'UNKNOWN_CHALLENGE' | 'EXPIRED' | 'REPLAYED' | 'DOMAIN_MISMATCH' | 'ADDRESS_MISMATCH' | 'BAD_SIGNATURE', msg: string) { super(msg) } }

export function buildMessage(c: Omit<Challenge, 'message' | 'used' | 'id'>): string {
  return [
    `${c.domain} wants you to sign in with your Ethereum account:`,
    c.address,
    '',
    'Sign in to STRIKE. This proves wallet ownership only. It does NOT authorise any trade, transfer or withdrawal.',
    '',
    `URI: ${c.uri}`,
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${c.nonce}`,
    `Issued At: ${new Date(c.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(c.expiresAt).toISOString()}`,
    `Resources:`,
    `- strike:env:${c.env}`,
  ].join('\n')
}

export class WalletAuth {
  private challenges = new Map<string, Challenge>()
  constructor(private readonly domain: string, private readonly uri: string, private readonly now: () => number = Date.now, private readonly ttlMs = 5 * 60e3) {}
  issue(address: string, env: Challenge['env'] = 'testnet'): Challenge {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new WalletAuthError('ADDRESS_MISMATCH', 'Invalid address')
    const issuedAt = this.now()
    const base = { address: address.toLowerCase(), domain: this.domain, uri: this.uri, nonce: randomId('', 12), env, issuedAt, expiresAt: issuedAt + this.ttlMs }
    const c: Challenge = { ...base, id: randomId('ch_'), message: buildMessage(base), used: false }
    this.challenges.set(c.id, c)
    this.gc()
    return c
  }
  /** Verify ownership. `presentedDomain` is the Origin host the browser actually sent (defends against phishing relays). */
  async verify(id: string, signature: Hex, presentedDomain: string): Promise<{ address: string }> {
    const c = this.challenges.get(id)
    if (!c) throw new WalletAuthError('UNKNOWN_CHALLENGE', 'Unknown challenge')
    if (c.used) throw new WalletAuthError('REPLAYED', 'Challenge already used')
    if (this.now() > c.expiresAt) throw new WalletAuthError('EXPIRED', 'Challenge expired')
    if (presentedDomain !== c.domain) throw new WalletAuthError('DOMAIN_MISMATCH', `Domain ${presentedDomain} ≠ ${c.domain}`)
    c.used = true // single-use even on failure → no signature grinding
    const ok = await verifyMessage({ address: c.address as Hex, message: c.message, signature }).catch(() => false)
    if (!ok) throw new WalletAuthError('BAD_SIGNATURE', 'Signature does not match address')
    return { address: c.address }
  }
  private gc() { const t = this.now(); for (const [k, c] of this.challenges) if (t > c.expiresAt + 60e3) this.challenges.delete(k) }
}
