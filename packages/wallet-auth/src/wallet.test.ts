import { describe, expect, it } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { WalletAuth } from './index'

const acct = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())

describe('wallet ownership challenge', () => {
  it('valid signature verifies once', async () => {
    const a = new WalletAuth('strike.app', 'https://strike.app')
    const c = a.issue(acct.address)
    expect(c.message).toContain('does NOT authorise any trade')
    const sig = await acct.signMessage({ message: c.message })
    await expect(a.verify(c.id, sig, 'strike.app')).resolves.toEqual({ address: acct.address.toLowerCase() })
    await expect(a.verify(c.id, sig, 'strike.app')).rejects.toMatchObject({ code: 'REPLAYED' })
  })
  it('forged signature (different key) rejected', async () => {
    const a = new WalletAuth('strike.app', 'https://strike.app'); const c = a.issue(acct.address)
    await expect(a.verify(c.id, await other.signMessage({ message: c.message }), 'strike.app')).rejects.toMatchObject({ code: 'BAD_SIGNATURE' })
  })
  it('wrong domain rejected', async () => {
    const a = new WalletAuth('strike.app', 'https://strike.app'); const c = a.issue(acct.address)
    await expect(a.verify(c.id, await acct.signMessage({ message: c.message }), 'evil.app')).rejects.toMatchObject({ code: 'DOMAIN_MISMATCH' })
  })
  it('expired challenge rejected', async () => {
    let t = 0; const a = new WalletAuth('strike.app', 'https://strike.app', () => t); const c = a.issue(acct.address); t = 10 * 60e3
    await expect(a.verify(c.id, await acct.signMessage({ message: c.message }), 'strike.app')).rejects.toMatchObject({ code: 'EXPIRED' })
  })
  it('signature over a different message rejected; unknown id rejected', async () => {
    const a = new WalletAuth('strike.app', 'https://strike.app'); const c = a.issue(acct.address)
    await expect(a.verify(c.id, await acct.signMessage({ message: 'hello' }), 'strike.app')).rejects.toMatchObject({ code: 'BAD_SIGNATURE' })
    await expect(a.verify('nope', '0x00', 'strike.app')).rejects.toMatchObject({ code: 'UNKNOWN_CHALLENGE' })
  })
})
