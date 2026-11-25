'use client'
import { useMemo, useState } from 'react'
import { renderOrbit } from '@strike/visual-engine'
import { api } from '@/lib/api'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, G2Canvas, Section, Stat, Tag, px, usd } from '@/components/ui'

function Orbit({ p, onChanged }: { p: any; onChanged: () => void }) {
  const [sc, setSc] = useState(0)
  const [stop, setStop] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const ref = p.markPx ?? p.entryPx
  const scPx = sc ? ref * (1 + sc / 100) : null
  const frame = useMemo(() => renderOrbit({ coin: p.coin, side: p.side, leverage: p.leverage, entryPx: p.entryPx, markPx: p.markPx, liquidationPx: p.liquidationPx, stopPx: p.protection?.stop?.triggerPx ?? null, takeProfitPx: p.protection?.takeProfit?.triggerPx ?? null, scenarioPx: scPx }), [p, scPx])
  async function addStop() { setMsg(null); try { const r = await api('/v1/protection/stop', { body: { coin: p.coin, stopPx: Number(stop) } }); setMsg(`Verified: ${r.verified.state}`); onChanged() } catch (e) { setMsg((e as Error).message) } }
  return (
    <Section kicker={`${p.side} · ${p.leverage}x · ${p.marginMode}`} title={p.coin} right={<Tag tone={p.protection.state === 'PROTECTED' ? 'mint' : 'amber'}>{p.protection.state === 'PROTECTED' ? '■' : '⚠'} {p.protection.state}</Tag>}>
      <G2Canvas frame={frame} label="Orbit · linear price rail, left = lower price" />
      <div className="mt-3 flex items-center gap-3 text-sm"><span className="kicker">Scenario</span><input aria-label="Scenario percent" type="range" min={-20} max={20} step={1} value={sc} onChange={(e) => setSc(Number(e.target.value))} className="flex-1 accent-lime" /><span className="num w-28 text-right">{sc > 0 ? '+' : ''}{sc}% {scPx ? `→ ${usd(p.szi * (scPx - ref))}` : ''}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entry" value={px(p.entryPx)} />
        <Stat label="Mark" value={px(p.markPx)} />
        <Stat label="Liquidation" value={px(p.liquidationPx)} sub={p.liquidationSource} />
        <Stat label="Unrealized" value={usd(p.unrealizedPnl)} tone={p.unrealizedPnl >= 0 ? 'pos' : 'neg'} />
      </div>
      <ul className="mt-2 text-xs text-ash">{p.protection.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
      {p.protection.state !== 'PROTECTED' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input aria-label="Stop price" placeholder={`Stop ${p.side === 'long' ? 'below' : 'above'} ${px(p.markPx)}`} value={stop} onChange={(e) => setStop(e.target.value)} className="w-48" />
          <button onClick={addStop} className="btn btn-lime" disabled={!stop}>Add protective stop</button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-amber">{msg}</p>}
    </Section>
  )
}

export default function Positions() {
  const { me } = useSession()
  const pf = usePoll(me ? '/v1/portfolio' : null, 5000)
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between"><div><div className="kicker">Instrument 03</div><h1 className="font-display text-5xl">Position Orbit</h1></div><div className="flex gap-2">{pf.data?.labels?.map((l: string) => <Tag key={l} tone="amber">{l}</Tag>)}</div></div>
      <ErrorBox err={pf.err} />
      {pf.data?.positions?.length === 0 && <p className="text-ash">No open positions.</p>}
      <div className="grid gap-6 lg:grid-cols-2">{pf.data?.positions.map((p: any) => <Orbit key={p.coin} p={p} onChanged={pf.reload} />)}</div>
    </div>
  )
}
