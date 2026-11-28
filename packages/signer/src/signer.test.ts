import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { AgentKeystore, NonceAllocator } from './index'

describe('nonce allocator', () => {
  it('unique, monotonic per signer under concurrency', async () => {
    const n = new NonceAllocator(() => 1000)
    const vals = await Promise.all(Array.from({ length: 500 }, async () => n.next('0xA')))
    expect(new Set(vals).size).toBe(500)
    expect(n.next('0xa')).toBe(1500) // case-insensitive signer key
    expect(n.next('0xB')).toBe(1000) // independent per signer
  })
  it('fast-forwards to wall clock', () => { let t = 10; const n = new NonceAllocator(() => t); n.next('x'); t = 1e6; expect(n.next('x')).toBe(1e6) })
})

describe('agent keystore', () => {
  it('isolates signers per user, encrypts at rest, enforces approval + revocation', () => {
    const ks = new AgentKeystore(randomBytes(32))
    const a = ks.create('u1', '0xMASTER1'); ks.create('u2', '0xMASTER2')
    expect(JSON.stringify(ks.info('u1'))).not.toMatch(/0x[0-9a-f]{64}/)
    expect(() => ks.signerFor('u1')).toThrow(/not yet approved/)
    ks.markApproved('u1')
    expect(ks.signerFor('u1').account.address).toBe(a.agentAddress)
    expect(ks.signerFor('u1').masterAddress).toBe('0xmaster1')
    expect(() => ks.signerFor('u2')).toThrow() // u2 cannot use u1's signer, and its own is unapproved
    ks.revoke('u1'); expect(() => ks.signerFor('u1')).toThrow(/revoked/)
    expect(() => ks.signerFor('nobody')).toThrow(/No API wallet/)
  })
  it('rejects bad KEK', () => { expect(() => new AgentKeystore(Buffer.alloc(16))).toThrow() })
})
