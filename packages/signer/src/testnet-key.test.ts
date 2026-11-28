import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { loadTestnetAccount, parseKeyMaterial } from './testnet-key'

describe('testnet key loader (runtime, never in repo)', () => {
  const pk = generatePrivateKey(); const addr = privateKeyToAccount(pk).address
  const dir = mkdtempSync(join(tmpdir(), 'strike-key-'))
  it('loads from env var', () => { const r = loadTestnetAccount({ STRIKE_TESTNET_PRIVATE_KEY: pk }, []); expect(r.account.address).toBe(addr); expect(r.source).toBe('env') })
  it('loads JSON {address, mnemonic, privateKey} file (mnemonic ignored) and raw hex file', () => {
    const j = join(dir, 'w.json'); writeFileSync(j, JSON.stringify({ address: addr, mnemonic: 'ignored words', privateKey: pk })); chmodSync(j, 0o600)
    expect(loadTestnetAccount({ STRIKE_TESTNET_KEY_FILE: j }).account.address).toBe(addr)
    const h = join(dir, 'k.key'); writeFileSync(h, pk.slice(2) + '\n'); chmodSync(h, 0o600)
    expect(loadTestnetAccount({}, [join(dir, 'missing'), h]).account.address).toBe(addr)
  })
  it('refuses world-readable files and malformed keys; errors never contain key material', () => {
    const j = join(dir, 'open.json'); writeFileSync(j, JSON.stringify({ privateKey: pk })); chmodSync(j, 0o644)
    expect(() => loadTestnetAccount({ STRIKE_TESTNET_KEY_FILE: j })).toThrow(/permissions too open/)
    try { parseKeyMaterial('0x1234') } catch (e) { expect((e as Error).message).not.toContain('1234') }
    expect(() => loadTestnetAccount({}, [join(dir, 'nope')])).toThrow(/No testnet key/)
  })
})
