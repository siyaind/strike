'use client'
import { useEffect, useRef, useState } from 'react'
import { startWebSpeech, webSpeechSupported, type WebSpeechHandle } from '@strike/voice-engine/webspeech'
import { api, ensureSession } from '@/lib/api'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, Section, Tag } from '@/components/ui'

const EXAMPLES = ['Show me the radar', 'What happens if BTC falls five percent?', 'Buy 100 dollars of ETH at 3x', 'Close half my SOL', 'Add a stop to ETH', 'Confirm the order']
export default function Voice() {
  const { me } = useSession()
  const [text, setText] = useState(''); const [res, setRes] = useState<any>(null); const [err, setErr] = useState<string | null>(null)
  const hist = usePoll(me ? '/v1/voice/history' : null, 10000)
  const diag = usePoll('/v1/diagnostics', 60000)
  const [canSpeak, setCanSpeak] = useState(false); const [listening, setListening] = useState(false); const [interim, setInterim] = useState('')
  const rec = useRef<WebSpeechHandle | null>(null)
  useEffect(() => { setCanSpeak(webSpeechSupported(window)) }, [])
  async function run(t: string, source: 'typed' | 'browser-stt' = 'typed', confidence: number | null = null) { setErr(null); try { await ensureSession(); setRes(await api('/v1/voice/command', { body: { text: t, source, confidence } })); hist.reload() } catch (e) { setErr((e as Error).message) } }
  async function speak() {
    if (listening) { rec.current?.stop(); return }
    setErr(null); setInterim(''); setListening(true)
    rec.current = startWebSpeech({ global: window, onInterim: setInterim })
    try { const r = await rec.current.done; setText(r.text); await run(r.text, 'browser-stt', r.confidence) } catch (e) { setErr((e as Error).message) } finally { setListening(false); rec.current = null }
  }
  return (
    <div className="space-y-6">
      <div><div className="kicker">Voice studio</div><h1 className="font-display text-5xl">Say it. Then check it.</h1></div>
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="stt-status">Browser speech: <Tag tone={canSpeak ? 'mint' : 'amber'}>{canSpeak ? 'available (free, Web Speech API)' : 'not supported in this browser'}</Tag> Server STT: <Tag tone={diag.data?.stt?.configured ? 'mint' : 'ash'}>{diag.data?.stt?.configured ? 'configured' : 'optional · off'}</Tag><span className="text-ash">Spoken and typed commands use the same deterministic grammar as G2 voice. Voice can never confirm a trade.</span></div>
      <ErrorBox err={err} />
      <Section kicker="Command" title="Parse a command">
        <form onSubmit={(e) => { e.preventDefault(); void run(text) }} className="flex gap-2"><input aria-label="Command" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. what happens if ETH rises 5 percent" className="flex-1" /><button className="btn btn-lime">Parse</button>{canSpeak && <button type="button" data-testid="mic" aria-pressed={listening} onClick={() => void speak()} className={`btn ${listening ? 'btn-lime' : 'btn-ghost'}`}>{listening ? '■ Stop' : '🎙 Speak'}</button>}</form>
        {listening && <p className="mt-2 text-sm text-ash" data-testid="interim">Listening… {interim}</p>}
        <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x} onClick={() => { setText(x); void run(x) }} className="btn btn-ghost text-xs">{x}</button>)}</div>
        {res && <div className="mt-4 rounded-xl border border-line p-3" data-testid="intent"><div className="kicker">Intent</div><pre className="num mt-1 whitespace-pre-wrap text-sm text-lime">{JSON.stringify(res.intent, null, 2)}</pre>{res.note && <p className="mt-2 text-sm text-amber">{res.note}</p>}</div>}
      </Section>
      <Section kicker="History" title="Recent commands"><ul className="space-y-1 text-sm">{(hist.data ?? []).slice(0, 12).map((h: any, i: number) => <li key={i} className="flex gap-3"><Tag tone="ash">{h.source}</Tag><span className="flex-1">{h.transcript}</span><span className="num text-ash">{h.intent.type}</span></li>)}</ul></Section>
    </div>
  )
}
