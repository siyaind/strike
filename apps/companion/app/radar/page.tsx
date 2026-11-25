'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { renderRadar } from '@strike/visual-engine'
import { usePoll } from '@/lib/hooks'
import { ErrorBox, Freshness, G2Canvas, Section, Tag, pct, px } from '@/components/ui'

const CATS = ['all', 'positions', 'watchlist', 'trending', 'movers', 'funding', 'volume'] as const
export default function Radar() {
  const [cat, setCat] = useState<string>('all')
  const [sel, setSel] = useState(0)
  const r = usePoll(`/v1/radar?category=${cat}`, 10000)
  const pts: any[] = r.data?.points ?? []
  const frame = useMemo(() => renderRadar(pts.slice(0, 24).map((p, i) => ({ ...p, selected: i === sel }))), [pts, sel])
  const s = pts[sel]
  return (
    <div className="space-y-6">
      <div><div className="kicker">Instrument 01</div><h1 className="font-display text-5xl">Market Radar</h1></div>
      <div className="flex flex-wrap gap-2">{CATS.map((c) => <button key={c} onClick={() => { setCat(c); setSel(0) }} className={`btn ${cat === c ? 'btn-lime' : 'btn-ghost'}`}>{c} {r.data?.counts?.[c] != null && <span className="num text-xs opacity-70">{r.data.counts[c]}</span>}</button>)}</div>
      <ErrorBox err={r.err} />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Section kicker={r.data?.labels?.join(' · ')} title="Universe" right={<Freshness at={r.at} err={r.err} />}>
          <G2Canvas frame={frame} label="● position  ○ watchlist  ◇ market  ⚠ funding stress" />
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-ash">{r.data && Object.entries(r.data.encoding).map(([k, v]) => <div key={k}><dt className="kicker inline">{k}</dt> <dd className="inline">{String(v)}</dd></div>)}</dl>
        </Section>
        <Section kicker="Selected" title={s ? <Link className="hover:text-lime" href={`/asset/${s.coin}`}>{s.coin} →</Link> : '—'}>
          {s && <>
            <div className="num text-3xl">{px(s.markPx)} <span className={s.change24hPct >= 0 ? 'text-mint' : 'text-ember'}>{pct(s.change24hPct, 1)}</span></div>
            <div className="mt-2 flex flex-wrap gap-1"><Tag tone="ash">score {Math.round(s.score)}</Tag>{s.mapping && <Tag tone={s.mapping === 'verified' ? 'mint' : 'amber'}>CG {s.mapping}</Tag>}</div>
            <p className="mt-3 text-sm">{String(s.explanation).replace(/^[^:]*:\s*/, '')}</p>
          </>}
          <ol className="mt-4 max-h-80 divide-y divide-line overflow-auto text-sm">
            {pts.map((p, i) => <li key={p.coin}><button onClick={() => setSel(i)} className={`flex w-full justify-between py-1.5 text-left ${i === sel ? 'text-lime' : ''}`}><span>{i + 1}. {p.coin}</span><span className="num">{pct(p.change24hPct, 1)}</span></button></li>)}
          </ol>
        </Section>
      </div>
      {r.data?.trending && <p className="text-xs text-ash">Trending: {r.data.trending.error ? `CoinGecko unavailable (${r.data.trending.error})` : r.data.trending.items.map((t: any) => `${t.coin ?? t.cgId} (${t.status})`).join(', ')} · {r.data.trending.attribution?.text}</p>}
    </div>
  )
}
