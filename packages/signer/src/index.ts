import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex, LocalAccount } from 'viem'
import { decryptSecret, encryptSecret } from '@strike/security'

/** Per-signer monotonic nonce allocator. Hyperliquid tracks nonces per SIGNER; nonces must be unique and within (T-2d, T+1d).
 * Uses max(now, last+1) so concurrent requests from many users/sessions never collide. */
export class NonceAllocator {
  private last = new Map<string, number>()
  constructor(private readonly now: () => number = Date.now) {}
  next(signer: string): number {
    const k = signer.toLowerCase()
    const n = Math.max(this.now(), (this.last.get(k) ?? 0) + 1)
    this.last.set(k, n)
    return n
  }
}

export interface StoredAgent { userId: string; masterAddress: string; agentAddress: string; agentName: string; envelope: string; env: 'testnet'; createdAt: number; approvedAt: number | null; revokedAt: number | null }

/** Server-side encrypted API-wallet (agent) keystore. The MASTER key never touches STRIKE. */
export class AgentKeystore {
  private byUser = new Map<string, StoredAgent>()
  constructor(private readonly kek: Buffer) { if (kek.length !== 32) throw new Error('STRIKE_SIGNER_KEK must decode to 32 bytes') }
  private aad(userId: string, agent: string) { return `strike-agent:${userId}:${agent.toLowerCase()}` }

  /** Generate a fresh testnet agent key (never reuse agent addresses — docs: nonces may be pruned on deregistration). */
  create(userId: string, masterAddress: string, agentName = 'strike', now = Date.now()): { agentAddress: Hex } {
    const pk = generatePrivateKey()
    const acct = privateKeyToAccount(pk)
    this.byUser.set(userId, { userId, masterAddress: masterAddress.toLowerCase(), agentAddress: acct.address, agentName, envelope: encryptSecret(pk, this.kek, this.aad(userId, acct.address)), env: 'testnet', createdAt: now, approvedAt: null, revokedAt: null })
    return { agentAddress: acct.address }
  }
  /** Import an agent key the user generated elsewhere (e.g. Hyperliquid testnet UI "API" page). */
  import(userId: string, masterAddress: string, agentPk: Hex, agentName = 'strike', now = Date.now()) {
    const acct = privateKeyToAccount(agentPk)
    this.byUser.set(userId, { userId, masterAddress: masterAddress.toLowerCase(), agentAddress: acct.address, agentName, envelope: encryptSecret(agentPk, this.kek, this.aad(userId, acct.address)), env: 'testnet', createdAt: now, approvedAt: now, revokedAt: null })
    return { agentAddress: acct.address }
  }
  markApproved(userId: string, now = Date.now()) { const a = this.byUser.get(userId); if (a) a.approvedAt = now }
  revoke(userId: string, now = Date.now()) { const a = this.byUser.get(userId); if (a) a.revokedAt = now }
  info(userId: string) { const a = this.byUser.get(userId); if (!a) return null; const { envelope: _e, ...rest } = a; return rest }
  /** Returns a signer ONLY for the owning user, only if approved and not revoked. */
  signerFor(userId: string): { account: LocalAccount; masterAddress: string } {
    const a = this.byUser.get(userId)
    if (!a) throw new Error('No API wallet for this user')
    if (a.revokedAt) throw new Error('API wallet revoked')
    if (!a.approvedAt) throw new Error('API wallet not yet approved by master wallet')
    return { account: privateKeyToAccount(decryptSecret(a.envelope, this.kek, this.aad(userId, a.agentAddress)) as Hex), masterAddress: a.masterAddress }
  }
}
