import { existsSync, readFileSync, statSync } from 'node:fs'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'

/**
 * Runtime loader for the dedicated Hyperliquid TESTNET wallet key. The key is never in the repo, never logged,
 * and only ever used with the testnet exchange client (mainnet signing is blocked in TestnetExchangeClient).
 *
 * Resolution order:
 *  1. STRIKE_TESTNET_PRIVATE_KEY  — 0x-prefixed 32-byte hex (e.g. a host secret env var)
 *  2. STRIKE_TESTNET_KEY_FILE     — path to a file containing raw hex OR JSON { "privateKey": "0x…" }
 *  3. defaults: /home/box/secrets/strike-testnet-wallet.json, then /home/box/secrets/strike-testnet.key
 * Files must not be group/world-readable (mode 600). Mnemonics in the JSON are ignored.
 */
export const DEFAULT_TESTNET_KEY_FILES = ['/home/box/secrets/strike-testnet-wallet.json', '/home/box/secrets/strike-testnet.key']
const HEX = /^0x[0-9a-fA-F]{64}$/

export class TestnetKeyError extends Error { name = 'TestnetKeyError' }

export function parseKeyMaterial(raw: string): `0x${string}` {
  const t = raw.trim()
  let k: unknown = t
  if (t.startsWith('{')) { try { const j = JSON.parse(t); k = j.privateKey ?? j.private_key ?? j.key } catch { throw new TestnetKeyError('Key file is not valid JSON') } }
  if (typeof k === 'string' && /^[0-9a-fA-F]{64}$/.test(k)) k = `0x${k}`
  if (typeof k !== 'string' || !HEX.test(k)) throw new TestnetKeyError('Key material is not a 32-byte hex private key')
  return k as `0x${string}`
}

export function loadTestnetAccount(env: NodeJS.ProcessEnv = process.env, defaults = DEFAULT_TESTNET_KEY_FILES): { account: PrivateKeyAccount; source: 'env' | 'file'; path: string | null } {
  if (env.STRIKE_TESTNET_PRIVATE_KEY) return { account: privateKeyToAccount(parseKeyMaterial(env.STRIKE_TESTNET_PRIVATE_KEY)), source: 'env', path: null }
  const candidates = env.STRIKE_TESTNET_KEY_FILE ? [env.STRIKE_TESTNET_KEY_FILE] : defaults
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const mode = statSync(p).mode & 0o077
    if (mode) throw new TestnetKeyError(`Refusing key file ${p}: permissions too open (chmod 600)`)
    return { account: privateKeyToAccount(parseKeyMaterial(readFileSync(p, 'utf8'))), source: 'file', path: p }
  }
  throw new TestnetKeyError('No testnet key: set STRIKE_TESTNET_PRIVATE_KEY or STRIKE_TESTNET_KEY_FILE')
}
