'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { renderRadar } from '@strike/visual-engine'
import { useSession, usePoll } from '@/lib/hooks'
import { ErrorBox, Freshness, G2Canvas, Section, Stat, Tag, pct, px, usd } from '@/components/ui'

export default function Workspace() {
  const { me, err: sErr } = useSession()
  const pf = usePoll(me ? '/v1/portfolio' : null, 5000)
  const radar = usePoll(me ? '/v1/radar' : null, 10000)
  const sent = usePoll(me ? '/v1/sentinel/events' : null, 10000)
  const frame = useMemo(() => radar.data ? renderRadar(radar.data.points.slice(0, 24).map((p: any) => ({ ...p, selected: false }))) : null, [radar.data])
  const p = pf.data
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="kicker">Workspace</div><h1 className="font-display text-5xl">Your desk, at a glance</h1></div>
        <div className="flex gap-2">{p?.labels?.map((l: string) => <Tag key={l} tone={l.includes('SIM') ? 'amber' : 'lime'}>{l}</Tag>)}{me && <Tag tone="ash">{me.mode}</Tag>}</div>
      </div>
      <ErrorBox err={sErr ?? pf.err} />
      {p && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="Account value" value={usd(p.accountValue)} sub={p.env === 'simulated' ? 'Simulated balance' : p.env} />
          <Stat label="Margin used" value={usd(p.totalMarginUsed)} sub={`${((p.totalMarginUsed / Math.max(1, p.accountValue)) * 100).toFixed(1)}% of value`} />
          <Stat label="Unrealized P&L" value={usd(p.positions.reduce((a: number, x: any) => a + (x.unrealizedPnl ?? 0), 0))} tone={p.positions.reduce((a: number, x: any) => a + (x.unrealizedPnl ?? 0), 0) >= 0 ? 'pos' : 'neg'} />
          <Stat label="Sentinel" value={sent.data?.events?.length ?? '—'} sub="current events" tone={sent.data?.events?.length ? 'neg' : undefined} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section kicker="Instrument 01" title="Market Radar" right={<Freshness at={radar.at} err={radar.err} />}>
          <G2Canvas frame={frame} label="Radar · X 24h move · Y volume rank · size OI" />
          <ul className="mt-4 divide-y divide-line text-sm">
            {radar.data?.points.slice(0, 6).map((r: any) => (
              <li key={r.coin} className="flex items-center gap-3 py-2">
                <Link href={`/asset/${r.coin}`} className="w-20 font-semibold hover:text-lime">{r.coin}</Link>
                <span className="num w-24 text-right">{px(r.markPx)}</span>
                <span className={`num w-20 text-right ${r.change24hPct >= 0 ? 'text-mint' : 'text-ember'}`}>{pct(r.change24hPct, 1)}</span>
                <span className="flex-1 truncate text-ash">{String(r.explanation).replace(/^[^:]*:\s*/, '')}</span>
              </li>
            ))}
          </ul>
        </Section>
        <div className="space-y-6">
          <Section kicker="Positions" title="Open book" right={<Link className="btn btn-ghost" href="/positions">Orbit →</Link>}>
            <ul className="space-y-2">
              {p?.positions.map((x: any) => (
                <li key={x.coin} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                  <div className="flex items-center gap-2"><span className="font-semibold">{x.coin}</span><Tag tone={x.side === 'long' ? 'mint' : 'ember'}>{x.side} {x.leverage}x</Tag>{x.protection.state !== 'PROTECTED' && <Tag tone="amber">⚠ {x.protection.state}</Tag>}</div>
                  <div className={`num ${x.unrealizedPnl >= 0 ? 'text-mint' : 'text-ember'}`}>{usd(x.unrealizedPnl)}</div>
                </li>
              ))}
            </ul>
          </Section>
          <Section kicker="Sentinel" title="Needs attention">
            {sent.data?.events?.length ? (
              <ul className="space-y-2 text-sm">{sent.data.events.map((e: any) => <li key={e.id} className="flex gap-2"><Tag tone={e.severity === 'CRITICAL' ? 'ember' : 'amber'}>{e.severity}</Tag><span>{e.reason}</span></li>)}</ul>
            ) : <p className="text-sm text-ash">All clear.</p>}
            <p className="mt-3 text-xs text-ash">{sent.data?.note}</p>
          </Section>
        </div>
      </div>
    </div>
  )
}
