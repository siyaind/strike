import { describe, expect, it } from 'vitest'
import { parseCommand, wordsToNumbers, type VoiceContext } from './parse'
import { PcmRecorder, pcmToWav, rms16, normalize } from './audio'

const ctx = (o: Partial<VoiceContext> = {}): VoiceContext => ({ coin: null, screen: 'radar', positions: ['BTC', 'SOL'], lastIntent: null, knownCoins: ['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'AVAX', 'LINK'], ...o })
const p = (s: string, o: Partial<VoiceContext> = {}) => parseCommand(s, ctx(o))

describe('voice grammar (spec command list)', () => {
  it.each([
    ['Show trending Hyperliquid markets.', { type: 'radar', category: 'trending' }],
    ['Show my watchlist.', { type: 'radar', category: 'watchlist' }],
    ['Only show my watchlist', { type: 'radar', category: 'watchlist' }],
    ['Show my moving positions.', { type: 'radar', category: 'positions' }],
    ['Why is ETH on the radar?', { type: 'why', coin: 'ETH' }],
    ['Why is HYPE on my radar?', { type: 'why', coin: 'HYPE' }],
    ['Show Market DNA for BTC.', { type: 'dna', coin: 'BTC' }],
    ['How liquid is HYPE?', { type: 'liquidity', coin: 'HYPE' }],
    ['Show my BTC position.', { type: 'position', coin: 'BTC' }],
    ['Show my largest exposure.', { type: 'largest-exposure' }],
    ['Show ETH funding history.', { type: 'funding', coin: 'ETH', scope: 'history' }],
    ['Which of my positions is paying the most funding?', { type: 'funding', coin: null, scope: 'most' }],
    ['What happens if ETH drops 5 percent?', { type: 'scenario', coin: 'ETH', pct: -5 }],
    ['What happens if BTC falls five percent?', { type: 'scenario', coin: 'BTC', pct: -5 }],
    ['Show me a $500 BTC long at 3x.', { type: 'shadow', coin: 'BTC', side: 'long', notionalUsd: 500, leverage: 3 }],
    ['Show me what a $500 ETH long at 3x would look like.', { type: 'shadow', coin: 'ETH', side: 'long', notionalUsd: 500, leverage: 3 }],
    ['Compare 2x and 5x leverage.', { type: 'compare-leverage', a: 2, b: 5 }],
    ['Prepare a $100 BTC Spot buy.', { type: 'prepare-order', coin: 'BTC', market: 'spot', side: 'buy', notionalUsd: 100, leverage: 1 }],
    ['Prepare a $200 ETH long at 2x.', { type: 'prepare-order', coin: 'ETH', market: 'perp', side: 'long', notionalUsd: 200, leverage: 2 }],
    ['Prepare a two hundred dollar ETH long at 2x', { type: 'prepare-order', coin: 'ETH', notionalUsd: 200 }],
    ['Close 25 percent of my SOL short.', { type: 'close-fraction', coin: 'SOL', fraction: 0.25, side: 'short' }],
    ['Prepare a stop 3 percent below entry.', { type: 'prepare-stop', pctFromEntry: -3 }],
    ['Go back.', { type: 'nav', action: 'back' }],
    ['Next position.', { type: 'nav', action: 'next' }],
    ['Show details.', { type: 'nav', action: 'details' }],
    ['Cancel preview.', { type: 'nav', action: 'cancel' }],
    ['Replay my last BTC trade.', { type: 'replay', coin: 'BTC', scope: 'last-trade' }],
    ['Show how my ETH position changed.', { type: 'replay', coin: 'ETH', scope: 'position' }],
    ['Show one-hour price movement.', { type: 'chart', coin: 'BTC', interval: '1h' }],
  ])('%s', (s, want) => { expect(p(s as string, { coin: 'BTC' })).toMatchObject(want as object) })

  it('context follow-ups', () => {
    expect(p('Make it $200.')).toEqual({ type: 'modify', notionalUsd: 200 })
    expect(p('Use 2x instead.')).toEqual({ type: 'modify', leverage: 2 })
    expect(p('What about funding?', { coin: 'SOL' })).toMatchObject({ type: 'funding', coin: 'SOL' })
    expect(p('Close half of this position.', { coin: 'SOL' })).toMatchObject({ type: 'close-fraction', coin: 'SOL', fraction: 0.5 })
    expect(p('How far am I from liquidation?', { coin: 'BTC' })).toMatchObject({ type: 'liq-distance', coin: 'BTC' })
    expect(p('Prepare to close half.', { coin: 'BTC' })).toMatchObject({ type: 'close-fraction', coin: 'BTC', fraction: 0.5 })
  })
  it('asks for clarification instead of guessing', () => {
    expect(p('Close half.')).toMatchObject({ type: 'clarify', missing: ['coin'] }) // two positions, no focus
    expect(p('Prepare a BTC long at 2x')).toMatchObject({ type: 'clarify', missing: ['amount'] })
    expect(p('Prepare a $100 BTC long')).toMatchObject({ type: 'clarify', missing: ['leverage'] })
    expect(p('Show market DNA')).toMatchObject({ type: 'clarify' })
    expect(p('close some')).toMatchObject({ type: 'clarify', missing: ['fraction'] })
  })
  it('voice can never confirm or execute', () => {
    for (const s of ['Confirm', 'confirm the order', 'Execute it', 'yes buy', 'submit', 'send it']) expect(p(s).type).toBe('confirm-refused')
  })
  it('ticker collision words are not coins', () => { expect(p('show me more').type).toBe('nav') })
  it('words to numbers', () => { expect(wordsToNumbers('two thousand five hundred')).toBe('2500'); expect(wordsToNumbers('twenty five percent')).toBe('25 percent') })
})

describe('audio pipeline', () => {
  const tone = (ms: number, amp: number) => { const n = (16000 * ms) / 1000; const b = new Uint8Array(n * 2); const dv = new DataView(b.buffer); for (let i = 0; i < n; i++) dv.setInt16(i * 2, Math.round(amp * Math.sin(i / 5)), true); return b }
  it('end-points on trailing silence after speech', () => {
    const r = new PcmRecorder()
    for (let i = 0; i < 5; i++) r.push(tone(100, 5000))
    let d = null; for (let i = 0; i < 12 && !d; i++) d = r.push(tone(100, 0))
    expect(d).toBe('silence'); expect(r.hadSpeech()).toBe(true)
  })
  it('stops at max duration', () => { const r = new PcmRecorder({ maxMs: 300, silenceMs: 9999, silenceRms: 1, minSpeechMs: 1 }); r.push(tone(100, 9)); r.push(tone(100, 9)); expect(r.push(tone(100, 9))).toBe('max') })
  it('silence-only capture has no speech', () => { const r = new PcmRecorder(); for (let i = 0; i < 20; i++) r.push(tone(100, 10)); expect(r.hadSpeech()).toBe(false) })
  it('wav header + normalize', () => { const w = pcmToWav(tone(100, 100)); expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF'); expect(rms16(normalize(tone(100, 100)))).toBeGreaterThan(rms16(tone(100, 100))) })
})
