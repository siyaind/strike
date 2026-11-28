'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, Section, usd } from '@/components/ui'

const FIELDS: Array<[string, string]> = [['maxOrderNotionalUsd', 'Max order ($)'], ['maxLeverage', 'Max leverage (x)'], ['maxPositionExposureUsd', 'Max position exposure ($)'], ['maxTotalExposureUsd', 'Max total exposure ($)'], ['maxConcentrationPct', 'Max concentration (%)'], ['maxSlippageBps', 'Max slippage (bp)'], ['riskBudgetUsd', 'Risk budget ($)']]
export default function RiskLab() {
  const { me } = useSession()
  const [pol, setPol] = useState<any>(null); const [sc, setSc] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [saved, setSaved] = useState(false)
  const pf = usePoll(me ? '/v1/portfolio' : null, 10000)
  useEffect(() => { if (!me) return; api('/v1/risk/policy').then(setPol).catch((e) => setErr(e.message)); api('/v1/risk/scenarios', { body: {} }).then(setSc).catch((e) => setErr(e.message)) }, [me, pf.at])
  async function save() { setSaved(false); try { const b: any = {}; for (const [k] of FIELDS) b[k] = Number(pol[k]); setPol(await api('/v1/risk/policy', { method: 'PUT', body: b })); setSaved(true) } catch (e) { setErr((e as Error).message) } }
  const max = Math.max(1, ...(sc?.scenarios ?? []).map((s: any) => Math.abs(s.totalUsd)))
  return (
    <div className="space-y-6">
      <div><div className="kicker">Risk Lab</div><h1 className="font-display text-5xl">What happens if…</h1></div>
      <ErrorBox err={err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section kicker="Portfolio scenarios" title="Uniform moves">
          <ul className="space-y-2">{sc?.scenarios.map((s: any) => (
            <li key={s.pct} className="grid grid-cols-[60px_1fr_100px] items-center gap-3 text-sm">
              <span className="num">{s.pct > 0 ? '+' : ''}{s.pct}%</span>
              <div className="relative h-3 rounded bg-slate"><div className={`absolute top-0 h-3 rounded ${s.totalUsd >= 0 ? 'left-1/2 bg-mint' : 'right-1/2 bg-ember'}`} style={{ width: `${(Math.abs(s.totalUsd) / max) * 50}%` }} /></div>
              <span className={`num text-right ${s.totalUsd >= 0 ? 'text-mint' : 'text-ember'}`}>{usd(s.totalUsd)}</span>
            </li>))}</ul>
          <p className="mt-3 text-xs text-ash">Every position moves by the same percentage from mark. Hypothetical; ignores funding, fees and liquidation cascades.</p>
        </Section>
        <Section kicker="Your limits" title="Risk policy">
          {pol && <div className="grid grid-cols-2 gap-3">{FIELDS.map(([k, l]) => <label key={k} className="text-sm"><span className="kicker block">{l}</span><input type="number" value={pol[k] ?? ''} onChange={(e) => setPol({ ...pol, [k]: e.target.value })} className="mt-1 w-full num" /></label>)}</div>}
          <div className="mt-4 flex items-center gap-3"><button onClick={save} className="btn btn-lime">Save policy</button>{saved && <span className="text-sm text-mint">Saved — applies to the next preview.</span>}</div>
          <p className="mt-3 text-xs text-ash">Checks with unknown inputs fail closed. Reduce-only orders skip exposure limits so you can always de-risk.</p>
        </Section>
      </div>
    </div>
  )
}
