import { describe, expect, it } from 'vitest'
import { startWebSpeech, webSpeechSupported } from './webspeech'
import { parseCommand } from './parse'

class FakeRec { static last: FakeRec; lang = ''; onresult: any; onerror: any; onend: any; started = false; constructor() { FakeRec.last = this } start() { this.started = true } stop() { this.onend?.() } }
const res = (t: string, isFinal: boolean, confidence = 0.9) => { const r: any = [{ transcript: t, confidence }]; r.isFinal = isFinal; return r }

describe('Web Speech API wrapper', () => {
  it('detects support (standard + webkit prefix)', () => {
    expect(webSpeechSupported({})).toBe(false)
    expect(webSpeechSupported({ webkitSpeechRecognition: FakeRec })).toBe(true)
  })
  it('returns the final transcript with confidence and streams interim text', async () => {
    const interim: string[] = []
    const h = startWebSpeech({ global: { SpeechRecognition: FakeRec }, onInterim: (t) => interim.push(t) })
    const r = FakeRec.last; expect(r.started).toBe(true); expect(r.lang).toBe('en-US')
    r.onresult({ resultIndex: 0, results: [res('buy 100 dollars', false)] })
    r.onresult({ resultIndex: 0, results: [res('buy 100 dollars of ETH', true, 0.87)] })
    r.onend()
    expect(await h.done).toEqual({ text: 'buy 100 dollars of ETH', confidence: 0.87 })
    expect(interim[0]).toBe('buy 100 dollars')
  })
  it('maps permission errors and no-speech to readable messages', async () => {
    const h = startWebSpeech({ global: { SpeechRecognition: FakeRec } }); FakeRec.last.onerror({ error: 'not-allowed' })
    await expect(h.done).rejects.toThrow(/permission denied/)
    const h2 = startWebSpeech({ global: { SpeechRecognition: FakeRec } }); FakeRec.last.onend()
    await expect(h2.done).rejects.toThrow(/No speech/)
  })
  it('rejects cleanly when unsupported (typed fallback)', async () => { await expect(startWebSpeech({ global: {} }).done).rejects.toThrow(/type the command/) })
  it('a spoken "confirm" can never authorise execution', async () => {
    const h = startWebSpeech({ global: { SpeechRecognition: FakeRec } }); FakeRec.last.onresult({ resultIndex: 0, results: [res('confirm the order', true)] }); FakeRec.last.onend()
    const { text } = await h.done
    expect(parseCommand(text, { coin: 'ETH', screen: 'preview', positions: [], lastIntent: null, knownCoins: ['ETH'] }).type).toBe('confirm-refused')
  })
})
