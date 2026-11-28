export type OrderState = 'DRAFT' | 'VALIDATED' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'SUBMITTING' | 'ACCEPTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'REJECTED' | 'CANCELED' | 'UNKNOWN' | 'EXPIRED' | 'INVALIDATED'
const T: Record<OrderState, OrderState[]> = {
  DRAFT: ['VALIDATED', 'REJECTED', 'CANCELED'],
  VALIDATED: ['AWAITING_CONFIRMATION', 'REJECTED', 'CANCELED'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELED', 'EXPIRED', 'INVALIDATED'],
  CONFIRMED: ['SUBMITTING', 'INVALIDATED', 'REJECTED'],
  SUBMITTING: ['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'UNKNOWN'],
  ACCEPTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'UNKNOWN'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'UNKNOWN'],
  UNKNOWN: ['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELED', 'UNKNOWN'], // only via reconciliation
  FILLED: [], REJECTED: [], CANCELED: [], EXPIRED: [], INVALIDATED: [],
}
export class IllegalTransitionError extends Error {}
export interface Transition { from: OrderState; to: OrderState; at: number; reason: string }
export class OrderLifecycle {
  state: OrderState = 'DRAFT'
  readonly history: Transition[] = []
  constructor(private readonly now: () => number = Date.now) {}
  to(next: OrderState, reason: string) {
    if (!T[this.state].includes(next)) throw new IllegalTransitionError(`${this.state} → ${next} not allowed`)
    this.history.push({ from: this.state, to: next, at: this.now(), reason }); this.state = next
    return this
  }
  get terminal() { return T[this.state].length === 0 }
}
