import { describe, expect, it } from 'vitest'
import { AssetRegistry } from './index'

const reg = () => { const r = new AssetRegistry(); r.setLivePerps(['BTC', 'ETH', 'HYPE', 'kPEPE', 'NEWT', 'TRUMP', 'ZZZ']); return r }

describe('asset registry', () => {
  it('verified mappings resolve', () => { expect(reg().resolve({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' })).toMatchObject({ status: 'verified', hlPerp: 'BTC' }) })
  it('ticker collision with a verified perp stays ambiguous', () => {
    const m = reg().resolve({ id: 'bitcoin-on-some-chain', symbol: 'BTC', name: 'Wrapped Fake BTC' })
    expect(m.status).toBe('ambiguous'); expect(m.hlPerp).toBeNull()
  })
  it('multiple CoinGecko assets sharing a symbol → ambiguous', () => {
    const m = reg().resolve({ id: 'zzz-one', symbol: 'ZZZ', name: 'Z1' }, [{ id: 'zzz-one', symbol: 'zzz' }, { id: 'zzz-two', symbol: 'ZZZ' }])
    expect(m.status).toBe('ambiguous')
  })
  it('known collision list → ambiguous', () => { expect(reg().resolve({ id: 'official-trump', symbol: 'TRUMP', name: 'x' }).status).toBe('ambiguous') })
  it('unique symbol → candidate only (research-only)', () => {
    const r = reg(); const m = r.resolve({ id: 'newton', symbol: 'NEWT', name: 'Newton' }, [{ id: 'newton', symbol: 'NEWT' }])
    expect(m.status).toBe('candidate'); expect(() => r.assertTradable(m)).toThrow(/blocked/)
  })
  it('PEPE maps to kPEPE (unit difference recorded)', () => { expect(reg().resolve({ id: 'pepe', symbol: 'pepe', name: 'Pepe' }).hlPerp).toBe('kPEPE') })
  it('no HL instrument → unmapped', () => { expect(reg().resolve({ id: 'foo', symbol: 'FOO', name: 'Foo' }).status).toBe('unmapped') })
  it('verified but not in live meta → unmapped', () => { expect(reg().resolve({ id: 'solana', symbol: 'sol', name: 'Solana' }).status).toBe('unmapped') })
  it('verified passes assertTradable', () => { const r = reg(); expect(() => r.assertTradable(r.resolve({ id: 'ethereum', symbol: 'eth', name: 'Ethereum' }))).not.toThrow() })
})
