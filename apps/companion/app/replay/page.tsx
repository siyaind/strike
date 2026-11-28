'use client'
import { useMemo, useState } from 'react'
import { renderChart } from '@strike/visual-engine'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, G2Canvas, Section, Tag } from '@/components/ui'

export default function Replay() {
  const { me } = useSession()
  const [coin, setCoin] = useState('BTC'); const [iv, setIv] = useState('1h')
  const m = usePoll(`/v1/replay/market?coin=${coin}&interval=${iv}&n=72`, 60000)
  const pos = usePoll(me ? `/v1/replay/position?coin=${coin}` : null, 15000)
  const frame = useMemo(() => m.data ? renderChart(m.data.candles.map((c: any) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c })), (pos.data?.events ?? []).filter((e: any) => e.time).map((e: any) => ({ t: e.time, kind: e.kind === 'funding' ? 'funding' : e.kind === 'close' ? 'close' : e.side === 'buy' ? 'buy' : 'sell' }))) : null, [m.data, pos.data])
  return (
    <div className="space-y-6">
      <div><div className="kicker">Replay</div><h1 className="font-display text-5xl">How did we get here?</h1></div>
      <div className="flex flex-wrap gap-2">{['BTC', 'ETH', 'SOL', 'HYPE'].map((c) => <button key={c} onClick={() => setCoin(c)} className={`btn ${coin === c ? 'btn-lime' : 'btn-ghost'}`}>{c}</button>)}<span className="mx-2 w-px bg-line" />{['15m', '1h', '4h', '1d'].map((c) => <button key={c} onClick={() => setIv(c)} className={`btn ${iv === c ? 'btn-lime' : 'btn-ghost'}`}>{c}</button>)}</div>
      <ErrorBox err={m.err} />
      <Section kicker={m.data?.source} title={`${coin} · last 72 × ${iv}`}><G2Canvas frame={frame} label="Replay · hollow = up candle, filled = down; ▲▼ = range extremes" /></Section>
      <Section kicker="Position timeline" title="Your events" right={pos.data && <Tag tone="ash">{pos.data.events.length} events</Tag>}>
        {pos.data?.narrative?.length ? <ol className="space-y-1 text-sm">{pos.data.narrative.map((n: string, i: number) => <li key={i} className="num">{n}</li>)}</ol> : <p className="text-sm text-ash">No fills for {coin} in this session yet.</p>}
        <p className="mt-2 text-xs text-ash">{pos.data?.note}</p>
      </Section>
    </div>
  )
}
