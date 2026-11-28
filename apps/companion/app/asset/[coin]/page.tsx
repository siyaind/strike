'use client'
import { use, useMemo, useState } from 'react'
import { renderDna, renderFunding, renderLens, renderShadow } from '@strike/visual-engine'
import { api, ensureSession } from '@/lib/api'
import { usePoll } from '@/lib/hooks'
import { ErrorBox, Freshness, G2Canvas, Section, Stat, Tag, px, usd } from '@/components/ui'

const SIZES = [50, 100, 250, 500, 1000]

export default function Asset({ params }: { params: Promise<{ coin: string }> }) {
  const { coin } = use(params)
  const dna = usePoll(`/v1/market-dna/${coin}`, 30000)
  const [size, setSize] = useState(250)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const lens = usePoll(`/v1/liquidity-lens/${coin}?size=${size}&side=${side}`, 4000)
  const funding = usePoll(`/v1/funding/${coin}`, 30000)
  const [lev, setLev] = useState(3)
  const [shadow, setShadow] = useState<any>(null)
  const [preview, setPreview] = useState<any>(null)
  const [receipt, setReceipt] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const dnaFrame = useMemo(() => dna.data ? renderDna(dna.data.axes.map((a: any) => ({ label: a.label, score: a.score, raw: a.raw }))) : null, [dna.data])
  const est = lens.data?.estimates?.find((e: any) => e.notionalUsd === size)
  const lensFrame = useMemo(() => lens.data ? renderLens({ bids: lens.data.bids, asks: lens.data.asks, orderNotional: size, side, sufficient: est?.sufficient ?? false, slippageBps: est?.slippageBps ?? null }) : null, [lens.data, size, side, est])
  const fundFrame = useMemo(() => funding.data ? renderFunding({ msToNext: funding.data.msToNext, intervalMs: funding.data.intervalMs, rateHourly: funding.data.rateHourly, history: funding.data.history.map((h: any) => h.rate) }) : null, [funding.data])
  const shadowFrame = useMemo(() => shadow ? renderShadow({ nowExposure: Math.abs(shadow.exposureNowUsd), afterExposure: Math.abs(shadow.exposureAfterUsd), scaleMax: Math.max(Math.abs(shadow.exposureNowUsd), Math.abs(shadow.exposureAfterUsd), 1) * 1.2, scenarios: shadow.scenarios.map((s: any) => ({ pct: s.pct, pnl: s.pnlChangeUsd })), selected: -1, riskBudgetPct: shadow.riskBudgetPct }) : null, [shadow])

  async function run<T>(fn: () => Promise<T>) { setBusy(true); setErr(null); try { return await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const simulate = () => run(async () => { await ensureSession(); setShadow(await api('/v1/shadow-trade', { body: { coin, side: side === 'buy' ? 'long' : 'short', notionalUsd: size, leverage: lev } })); setPreview(null); setReceipt(null) })
  const doPreview = () => run(async () => { await ensureSession(); setPreview(await api('/v1/trade/preview', { body: { coin, side, notionalUsd: size, leverage: lev } })); setReceipt(null) })
  const confirm = () => run(async () => { const r = await api('/v1/trade/confirm', { body: { proposalId: preview.proposal.proposalId, confirmToken: preview.confirmToken } }); setReceipt(r); setPreview(null) })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="kicker">Hyperliquid perpetual</div><h1 className="font-display text-6xl">{coin}</h1></div>
        <div className="flex gap-3">
          <Stat label="Mid" value={px(lens.data?.mid)} sub={lens.data ? `book age ${Math.round(lens.data.ageMs / 100) / 10}s` : undefined} />
          <Stat label="Spread" value={lens.data?.spreadBps != null ? `${lens.data.spreadBps.toFixed(2)} bp` : '—'} />
          <Stat label="Funding / h" value={funding.data ? `${(funding.data.rateHourly * 100).toFixed(4)}%` : '—'} sub={funding.data?.direction?.replace(/-/g, ' ')} />
        </div>
      </div>
      <ErrorBox err={dna.err ?? lens.err} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section kicker="Instrument 02" title="Market DNA" right={<Freshness at={dna.at} err={dna.err} />}>
          <G2Canvas frame={dnaFrame} label="DNA · percentile vs live HL universe" />
          {dna.data && <p className="mt-3 text-sm">{dna.data.narrative}</p>}
          <table className="mt-3 w-full text-sm">
            <thead className="kicker text-left"><tr><th className="py-1">Axis</th><th>Raw</th><th>Pctile</th><th>Method</th></tr></thead>
            <tbody className="divide-y divide-line">
              {dna.data?.axes.map((a: any) => (
                <tr key={a.dim}><td className="py-1.5 font-semibold">{a.label}</td><td className="num">{a.raw}</td><td className="num">{a.score == null ? <Tag tone="ash">n/a</Tag> : Math.round(a.score * 100)}</td><td className="text-xs text-ash" title={a.source}>{a.method}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section kicker="Instrument 04" title="Liquidity Lens" right={<Freshness at={lens.at} err={lens.err} />}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(['buy', 'sell'] as const).map((s) => <button key={s} onClick={() => setSide(s)} className={`btn ${side === s ? 'btn-lime' : 'btn-ghost'}`}>{s}</button>)}
            <span className="mx-2 h-5 w-px bg-line" />
            {SIZES.map((s) => <button key={s} onClick={() => setSize(s)} className={`btn ${size === s ? 'btn-lime' : 'btn-ghost'}`}>${s}</button>)}
          </div>
          <G2Canvas frame={lensFrame} label="Lens · cumulative visible depth ±50bp" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Est. VWAP" value={px(est?.vwap)} />
            <Stat label="Est. slippage" value={est?.slippageBps != null ? `${est.slippageBps.toFixed(2)} bp` : '—'} />
            <Stat label="Visible depth" value={est ? (est.sufficient ? 'Sufficient' : 'Insufficient') : '—'} tone={est && !est.sufficient ? 'neg' : undefined} />
          </div>
          <p className="mt-2 text-xs text-ash">{lens.data?.note}</p>
        </Section>

        <Section kicker="Instrument 05" title="Shadow Trade" right={<Tag tone="amber">Simulation</Tag>}>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ash">{side === 'buy' ? 'Long' : 'Short'} ${size}</span>
            <label className="flex items-center gap-2">Leverage <input aria-label="Leverage" type="number" min={1} max={20} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="w-20" /></label>
            <button disabled={busy} onClick={simulate} className="btn btn-ghost">Simulate</button>
            <button disabled={busy} onClick={doPreview} className="btn btn-lime">Preview order</button>
          </div>
          {shadowFrame && <G2Canvas frame={shadowFrame} label="Shadow · exposure now→after, P&L by move" />}
          {shadow && (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Est. entry" value={px(shadow.estEntryPx)} sub={shadow.entrySource} />
              <Stat label="Fee" value={usd(shadow.estFeeUsd)} sub={shadow.feeSource} />
              <Stat label="Initial margin" value={usd(shadow.initialMarginUsd)} />
              <Stat label="Funding / h" value={usd(-shadow.fundingPerHourUsd)} sub="+ = you receive" />
            </div>
          )}
          {shadow && <p className="mt-2 text-xs text-ash">{shadow.liquidationNote}</p>}
          <ErrorBox err={err} />
          {preview && (
            <div className="mt-4 rounded-xl border border-lime/60 bg-lime/5 p-4">
              <div className="flex items-center justify-between"><div className="kicker">Order preview</div><Tag tone={preview.label.startsWith('SIM') ? 'amber' : 'lime'}>{preview.label}</Tag></div>
              <div className="num mt-2 text-lg">{preview.proposal.wire.isBuy ? 'BUY' : 'SELL'} {preview.proposal.wire.sz} {coin} · IOC · {preview.proposal.priceConstraint}</div>
              <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2">
                {preview.proposal.risk.checks.map((c: any) => <li key={c.rule} className="flex gap-2"><span className={c.status === 'pass' ? 'text-mint' : 'text-ember'}>{c.status === 'pass' ? '✓' : '✕'}</span><span>{c.rule}</span><span className="num text-ash">{c.value} / {c.limit}</span></li>)}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setPreview(null)} className="btn btn-ghost">Cancel</button>
                <button disabled={busy || !preview.proposal.risk.ok} onClick={confirm} className="btn btn-lime">{preview.proposal.risk.ok ? 'Confirm' : 'Blocked by risk'}</button>
              </div>
              <p className="mt-2 text-xs text-ash">Single-use confirmation, expires in 30s. Re-validated against a fresh order book before submission.</p>
            </div>
          )}
          {receipt && (
            <div className="mt-4 rounded-xl border border-line p-4" data-testid="receipt">
              <div className="flex items-center justify-between"><div className="kicker">Receipt {receipt.id}</div><Tag tone="amber">{receipt.label}</Tag></div>
              <div className="num mt-2">{receipt.status} · {receipt.filledSz}/{receipt.requestedSz} @ {receipt.avgPx ?? '—'}</div>
            </div>
          )}
        </Section>

        <Section kicker="Instrument 06" title="Funding Clock" right={<Freshness at={funding.at} err={funding.err} />}>
          <G2Canvas frame={fundFrame} label="Funding · hourly settlement" />
          {funding.data && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat label="Next payment" value={`${Math.round(funding.data.msToNext / 60000)} min`} sub={funding.data.scheduleSource} />
              <Stat label="48h mean" value={funding.data.historyStats ? `${(funding.data.historyStats.mean * 100).toFixed(4)}%` : '—'} />
              <Stat label="Your est. next" value={funding.data.estNextPaymentUsd == null ? 'No position' : usd(-funding.data.estNextPaymentUsd)} />
            </div>
          )}
          <p className="mt-2 text-xs text-ash">{funding.data?.assumption}</p>
        </Section>
      </div>
    </div>
  )
}
