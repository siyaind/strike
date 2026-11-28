/**
 * Free, on-device/browser speech-to-text via the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * No server, no key, no cost. Availability depends on the browser (Chrome/Edge/Safari; not Firefox) and the
 * Even app WebView. The transcript is ONLY ever parsed into an intent for review; it can never confirm a trade.
 */
export interface WebSpeechResult { text: string; confidence: number | null }
export interface WebSpeechHandle { stop(): void; done: Promise<WebSpeechResult> }

type Ctor = new () => any
export function webSpeechCtor(g: any = globalThis): Ctor | null {
  return (g?.SpeechRecognition ?? g?.webkitSpeechRecognition ?? null) as Ctor | null
}
export function webSpeechSupported(g: any = globalThis): boolean { return webSpeechCtor(g) != null }

/** Start one-shot recognition. Resolves with the best final transcript; rejects with a readable message. */
export function startWebSpeech(opts: { lang?: string; maxMs?: number; onInterim?: (t: string) => void; global?: any } = {}): WebSpeechHandle {
  const C = webSpeechCtor(opts.global)
  if (!C) return { stop() {}, done: Promise.reject(new Error('Browser speech recognition not available — type the command instead.')) }
  const rec = new C()
  rec.lang = opts.lang ?? 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = '', conf: number | null = null, settled = false
  const done = new Promise<WebSpeechResult>((resolve, reject) => {
    const timer = setTimeout(() => { try { rec.stop() } catch { /* ignore */ } }, opts.maxMs ?? 8000)
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const r = e.results[i], alt = r[0]
        if (r.isFinal) { finalText += alt.transcript; conf = typeof alt.confidence === 'number' && alt.confidence > 0 ? alt.confidence : conf }
        else interim += alt.transcript
      }
      opts.onInterim?.((finalText + interim).trim())
    }
    rec.onerror = (e: any) => {
      if (settled) return; settled = true; clearTimeout(timer)
      const code = e?.error ?? 'unknown'
      reject(new Error(code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone permission denied — type the command instead.' : code === 'no-speech' ? 'No speech heard — try again or type.' : `Speech recognition error: ${code}`))
    }
    rec.onend = () => {
      if (settled) return; settled = true; clearTimeout(timer)
      const text = finalText.trim()
      if (text) resolve({ text, confidence: conf }); else reject(new Error('No speech heard — try again or type.'))
    }
  })
  rec.start()
  return { stop: () => { try { rec.stop() } catch { /* ignore */ } }, done }
}
