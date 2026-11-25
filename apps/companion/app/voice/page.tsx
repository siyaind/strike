'use client'
import { useState } from 'react'
import { api, ensureSession } from '@/lib/api'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, Section, Tag } from '@/components/ui'

const EXAMPLES = ['Show me the radar', 'What happens if BTC falls five percent?', 'Buy 100 dollars of ETH at 3x', 'Close half my SOL', 'Add a stop to ETH', 'Confirm the order']
export default function Voice() {
  const { me } = useSession()
  const [text, setText] = useState(''); const [res, setRes] = useState<any>(null); const [err, setErr] = useState<string | null>(null)
  const hist = usePoll(me ? '/v1/voice/history' : null, 10000)
  const diag = usePoll('/v1/diagnostics', 60000)
  async function run(t: string) { setErr(null); try { await ensureSession(); setRes(await api('/v1/voice/command', { body: { text: t, source: 'typed' } })); hist.reload() } catch (e) { setErr((e as Error).message) } }
  return (
    <div className="space-y-6">
      <div><div className="kicker">Voice studio</div><h1 className="font-display text-5xl">Say it. Then check it.</h1></div>
      <div className="flex items-center gap-2 text-sm">Speech-to-text: <Tag tone={diag.data?.stt?.configured ? 'mint' : 'amber'}>{diag.data?.stt?.configured ? 'configured' : 'not configured'}</Tag><span className="text-ash">Typed commands use the same deterministic grammar as G2 voice.</span></div>
      <ErrorBox err={err} />
      <Section kicker="Command" title="Parse a command">
        <form onSubmit={(e) => { e.preventDefault(); void run(text) }} className="flex gap-2"><input aria-label="Command" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. what happens if ETH rises 5 percent" className="flex-1" /><button className="btn btn-lime">Parse</button></form>
        <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x} onClick={() => { setText(x); void run(x) }} className="btn btn-ghost text-xs">{x}</button>)}</div>
        {res && <div className="mt-4 rounded-xl border border-line p-3" data-testid="intent"><div className="kicker">Intent</div><pre className="num mt-1 whitespace-pre-wrap text-sm text-lime">{JSON.stringify(res.intent, null, 2)}</pre>{res.note && <p className="mt-2 text-sm text-amber">{res.note}</p>}</div>}
      </Section>
      <Section kicker="History" title="Recent commands"><ul className="space-y-1 text-sm">{(hist.data ?? []).slice(0, 12).map((h: any, i: number) => <li key={i} className="flex gap-3"><Tag tone="ash">{h.source}</Tag><span className="flex-1">{h.transcript}</span><span className="num text-ash">{h.intent.type}</span></li>)}</ul></Section>
    </div>
  )
}
