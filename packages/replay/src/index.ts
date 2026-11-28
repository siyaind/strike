export type ReplayKind = 'entry' | 'add' | 'partial-close' | 'close' | 'flip' | 'protection-created' | 'protection-failed' | 'funding'
export interface ReplayEvent { t: number; kind: ReplayKind; coin: string; px: number | null; sz: number | null; sziAfter: number | null; detail: string; provenance: 'observed' | 'reconstructed'; source: string }
export interface FillLike { coin: string; px: string; sz: string; side: 'A' | 'B'; time: number; startPosition: string; dir: string; closedPnl: string; oid: number; fee: string }
export interface FundingLike { time: number; delta: { coin: string; usdc: string; szi: string; fundingRate: string } }
export interface ProtectionLogEntry { t: number; coin: string; ok: boolean; detail: string }

/** Build a position timeline. Fills/fundings are OBSERVED exchange records; position size after each fill is RECONSTRUCTED
 * from the exchange-provided startPosition + fill size (labelled). History starts at the earliest record available. */
export function positionTimeline(coin: string, fills: FillLike[], fundings: FundingLike[] = [], protection: ProtectionLogEntry[] = []): { events: ReplayEvent[]; boundary: number | null; note: string } {
  const ev: ReplayEvent[] = []
  for (const f of fills.filter((x) => x.coin === coin).sort((a, b) => a.time - b.time)) {
    const start = Number(f.startPosition), sz = Number(f.sz), signed = f.side === 'B' ? sz : -sz, after = start + signed
    let kind: ReplayKind
    if (start === 0) kind = 'entry'
    else if (after === 0) kind = 'close'
    else if (Math.sign(after) !== Math.sign(start)) kind = 'flip'
    else if (Math.abs(after) > Math.abs(start)) kind = 'add'
    else kind = 'partial-close'
    ev.push({ t: f.time, kind, coin, px: Number(f.px), sz, sziAfter: after, detail: `${f.dir} ${f.sz} @ ${f.px}${Number(f.closedPnl) ? ` · PnL ${Number(f.closedPnl).toFixed(2)}` : ''} · fee ${f.fee}`, provenance: 'reconstructed', source: 'hyperliquid userFills (startPosition + sz)' })
  }
  for (const u of fundings.filter((x) => x.delta.coin === coin)) ev.push({ t: u.time, kind: 'funding', coin, px: null, sz: Number(u.delta.szi), sziAfter: Number(u.delta.szi), detail: `Funding ${Number(u.delta.usdc) < 0 ? 'paid' : 'received'} ${Math.abs(Number(u.delta.usdc)).toFixed(4)} USDC at ${(Number(u.delta.fundingRate) * 100).toFixed(4)}%`, provenance: 'observed', source: 'hyperliquid userFunding' })
  for (const p of protection.filter((x) => x.coin === coin)) ev.push({ t: p.t, kind: p.ok ? 'protection-created' : 'protection-failed', coin, px: null, sz: null, sziAfter: null, detail: p.detail, provenance: 'observed', source: 'STRIKE protection log' })
  ev.sort((a, b) => a.t - b.t)
  return { events: ev, boundary: ev[0]?.t ?? null, note: 'History begins at the earliest exchange record returned (userFills returns at most the 2000 most recent fills). Earlier activity is not shown.' }
}

export function lastTradeWindow(events: ReplayEvent[]): ReplayEvent[] {
  const lastEntry = [...events].reverse().find((e) => e.kind === 'entry')
  if (!lastEntry) return []
  return events.filter((e) => e.t >= lastEntry.t)
}

export function narrate(e: ReplayEvent): string {
  const when = new Date(e.t).toISOString().slice(5, 16).replace('T', ' ')
  return `${when} UTC · ${e.kind.toUpperCase()} · ${e.detail}${e.provenance === 'reconstructed' ? ' (size reconstructed)' : ''}`
}
