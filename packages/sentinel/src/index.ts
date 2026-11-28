export type Severity = 'CRITICAL' | 'WARNING' | 'INFORMATIONAL'
export interface SentinelEvent { id: string; key: string; severity: Severity; coin: string | null; account: string; reason: string; sourceTs: number; status: 'current' | 'resolved'; action: 'review-position' | 'prepare-stop' | 'simulate-shock' | 'prepare-reduce' | 'prepare-close' | 'review-orders' | 'reconnect' | 'none'; firstSeen: number; lastSeen: number }
export interface SentinelPolicy { liqCriticalPct: number; liqWarningPct: number; marginWarningPct: number; pnlSwingPct: number; fundingHourlyWarn: number; concentrationPct: number; staleMs: number }
export const DEFAULT_SENTINEL: SentinelPolicy = { liqCriticalPct: 5, liqWarningPct: 10, marginWarningPct: 60, pnlSwingPct: 10, fundingHourlyWarn: 0.0002, concentrationPct: 70, staleMs: 60_000 }

export interface SentinelPosition { coin: string; szi: number; markPx: number | null; liquidationPx: number | null; unrealizedPnl: number; marginUsed: number; fundingHourly: number | null; protection: string }
export interface SentinelInput { account: string; now: number; dataTs: number; wsConnected: boolean | null; accountValue: number | null; totalMarginUsed: number | null; positions: SentinelPosition[]; prevPositions?: SentinelPosition[] | null; knownOrderIds?: Set<number>; fillsSinceLast?: Array<{ oid: number; coin: string; time: number }>; priceAlerts?: Array<{ coin: string; above?: number; below?: number }> }

const SEV_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFORMATIONAL: 2 }

/** Pure rule evaluation → current events. Never triggers trades; every event carries a REVIEW action only. */
export function evaluateSentinel(i: SentinelInput, p: SentinelPolicy = DEFAULT_SENTINEL): Omit<SentinelEvent, 'id' | 'firstSeen' | 'lastSeen' | 'status'>[] {
  const out: Omit<SentinelEvent, 'id' | 'firstSeen' | 'lastSeen' | 'status'>[] = []
  const add = (key: string, severity: Severity, coin: string | null, reason: string, action: SentinelEvent['action']) => out.push({ key, severity, coin, account: i.account, reason, sourceTs: i.dataTs, action })
  if (i.now - i.dataTs > p.staleMs) add('stale', 'WARNING', null, `Account data is ${Math.round((i.now - i.dataTs) / 1000)}s old`, 'reconnect')
  if (i.wsConnected === false) add('ws', 'WARNING', null, 'Live stream disconnected — values may be stale', 'reconnect')
  const gross = i.positions.reduce((a, x) => a + Math.abs(x.szi) * (x.markPx ?? 0), 0)
  for (const pos of i.positions) {
    if (pos.szi === 0) continue
    const side = pos.szi > 0 ? 'LONG' : 'SHORT'
    if (pos.liquidationPx && pos.markPx) {
      const d = (Math.abs(pos.markPx - pos.liquidationPx) / pos.markPx) * 100
      if (d <= p.liqCriticalPct) add(`liq:${pos.coin}`, 'CRITICAL', pos.coin, `${pos.coin} ${side}: liquidation ${d.toFixed(1)}% away`, 'review-position')
      else if (d <= p.liqWarningPct) add(`liq:${pos.coin}`, 'WARNING', pos.coin, `${pos.coin} ${side}: liquidation ${d.toFixed(1)}% away`, 'review-position')
    }
    if (pos.protection === 'UNPROTECTED' || pos.protection === 'PROTECTION_FAILED') add(`prot:${pos.coin}`, pos.protection === 'PROTECTION_FAILED' ? 'CRITICAL' : 'WARNING', pos.coin, `${pos.coin} ${side}: protective stop ${pos.protection === 'PROTECTION_FAILED' ? 'FAILED' : 'NOT FOUND'}`, 'prepare-stop')
    if (pos.fundingHourly != null && Math.abs(pos.fundingHourly) >= p.fundingHourlyWarn && Math.sign(pos.fundingHourly) === Math.sign(pos.szi)) add(`fund:${pos.coin}`, 'INFORMATIONAL', pos.coin, `${pos.coin} ${side} is paying funding ${(pos.fundingHourly * 100).toFixed(4)}%/h`, 'review-position')
    if (gross > 0 && i.positions.length > 1) { const c = ((Math.abs(pos.szi) * (pos.markPx ?? 0)) / gross) * 100; if (c >= p.concentrationPct) add(`conc:${pos.coin}`, 'INFORMATIONAL', pos.coin, `${pos.coin} is ${c.toFixed(0)}% of gross exposure`, 'review-position') }
    const prev = i.prevPositions?.find((x) => x.coin === pos.coin)
    if (prev && pos.marginUsed > 0) {
      const swing = ((pos.unrealizedPnl - prev.unrealizedPnl) / pos.marginUsed) * 100
      if (Math.abs(swing) >= p.pnlSwingPct) add(`pnl:${pos.coin}`, 'WARNING', pos.coin, `${pos.coin} unrealised PnL moved ${swing > 0 ? '+' : ''}${swing.toFixed(0)}% of margin since last check`, 'simulate-shock')
    }
    for (const a of i.priceAlerts ?? []) if (a.coin === pos.coin && pos.markPx != null && ((a.above && pos.markPx >= a.above) || (a.below && pos.markPx <= a.below))) add(`alert:${pos.coin}`, 'INFORMATIONAL', pos.coin, `${pos.coin} crossed your alert at ${a.above ?? a.below}`, 'review-position')
  }
  if (i.prevPositions) for (const prev of i.prevPositions) {
    const now = i.positions.find((x) => x.coin === prev.coin)
    if (!now || now.szi !== prev.szi) add(`ext:${prev.coin}`, 'WARNING', prev.coin, `${prev.coin} position changed ${prev.szi} → ${now?.szi ?? 0} (may be outside STRIKE)`, 'review-position')
  }
  for (const f of i.fillsSinceLast ?? []) if (i.knownOrderIds && !i.knownOrderIds.has(f.oid)) add(`fill:${f.oid}`, 'WARNING', f.coin, `Unexpected fill on ${f.coin} (order ${f.oid} not placed by STRIKE)`, 'review-orders')
  if (i.accountValue && i.totalMarginUsed != null) { const u = (i.totalMarginUsed / i.accountValue) * 100; if (u >= p.marginWarningPct) add('margin', 'WARNING', null, `Margin utilisation ${u.toFixed(0)}%`, 'prepare-reduce') }
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.key.localeCompare(b.key))
}

/** Stateful tracker: dedupes by key, marks events resolved when their condition clears. Per account (tenant-isolated). */
export class SentinelTracker {
  private events = new Map<string, SentinelEvent>()
  private seq = 0
  update(current: ReturnType<typeof evaluateSentinel>, now: number): SentinelEvent[] {
    const keys = new Set(current.map((c) => c.key))
    for (const c of current) {
      const e = this.events.get(c.key)
      if (e && e.status === 'current') { Object.assign(e, c, { lastSeen: now }) }
      else this.events.set(c.key, { ...c, id: `sev_${++this.seq}`, status: 'current', firstSeen: now, lastSeen: now })
    }
    for (const e of this.events.values()) if (e.status === 'current' && !keys.has(e.key)) e.status = 'resolved'
    return this.list()
  }
  list() { return [...this.events.values()].sort((a, b) => (a.status === b.status ? SEV_RANK[a.severity] - SEV_RANK[b.severity] : a.status === 'current' ? -1 : 1)) }
}
