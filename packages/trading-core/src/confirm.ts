import { hmac, safeEqual } from '@strike/security'
import type { OrderProposal } from './proposal'

export class ConfirmationError extends Error { constructor(readonly code: 'BAD_TOKEN' | 'EXPIRED' | 'REPLAYED' | 'WRONG_USER' | 'UNKNOWN_PROPOSAL' | 'RISK_FAILED' | 'IN_PROGRESS', msg: string) { super(msg) } }

/** Short-lived single-use confirmation token bound to proposalId + exact parameter hash + user + expiry. */
export class ConfirmationRegistry {
  private proposals = new Map<string, OrderProposal>()
  private consumed = new Set<string>()
  private inFlight = new Set<string>()
  constructor(private readonly secret: string, private readonly now: () => number = Date.now) { if (secret.length < 16) throw new Error('confirmation secret too short') }
  token(p: OrderProposal) { return hmac(this.secret, `${p.proposalId}|${p.hash}|${p.userId}|${p.expiresAt}`) }
  register(p: OrderProposal) { this.proposals.set(p.proposalId, p); return this.token(p) }
  get(id: string) { return this.proposals.get(id) }
  /** Atomically claim: verifies token/user/expiry/risk and marks consumed BEFORE any side effect (idempotency). */
  claim(proposalId: string, token: string, userId: string): OrderProposal {
    const p = this.proposals.get(proposalId)
    if (!p) throw new ConfirmationError('UNKNOWN_PROPOSAL', 'Unknown proposal')
    if (p.userId !== userId) throw new ConfirmationError('WRONG_USER', 'Proposal belongs to another user')
    if (!safeEqual(token, this.token(p))) throw new ConfirmationError('BAD_TOKEN', 'Confirmation token does not match proposal parameters')
    if (this.consumed.has(proposalId)) throw new ConfirmationError('REPLAYED', 'Proposal already confirmed')
    if (this.inFlight.has(proposalId)) throw new ConfirmationError('IN_PROGRESS', 'Confirmation already in progress')
    if (this.now() > p.expiresAt) throw new ConfirmationError('EXPIRED', 'Proposal expired — prepare a new one')
    if (!p.risk.ok) throw new ConfirmationError('RISK_FAILED', 'Risk checks did not pass')
    this.consumed.add(proposalId)
    return p
  }
  cancel(proposalId: string, userId: string) { const p = this.proposals.get(proposalId); if (p && p.userId === userId) { this.consumed.add(proposalId); return true } return false }
  purgeExpired() { const t = this.now(); for (const [k, p] of this.proposals) if (t > p.expiresAt + 10 * 60e3) this.proposals.delete(k) }
}
