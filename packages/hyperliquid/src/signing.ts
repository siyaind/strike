import { encode } from '@msgpack/msgpack'
import { keccak256, type Hex, type LocalAccount, concatBytes, hexToBytes, toBytes, recoverTypedDataAddress } from 'viem'
import { assertSigningAllowed, type HlEnv } from '@strike/shared'

export interface Signature { r: Hex; s: Hex; v: number }

/** Matches python SDK `action_hash`: msgpack(action) || nonce(u64 BE) || vault flag [|| addr] [|| 0x00 || expiresAfter(u64 BE)]. */
export function actionHash(action: unknown, vaultAddress: string | null, nonce: number, expiresAfter?: number | null): Hex {
  const packed = encode(action, { ignoreUndefined: true })
  const n = new Uint8Array(8)
  new DataView(n.buffer).setBigUint64(0, BigInt(nonce))
  const parts: Uint8Array[] = [packed, n]
  if (vaultAddress == null) parts.push(new Uint8Array([0]))
  else parts.push(new Uint8Array([1]), hexToBytes(vaultAddress.toLowerCase() as Hex))
  if (expiresAfter != null) {
    const e = new Uint8Array(8)
    new DataView(e.buffer).setBigUint64(0, BigInt(expiresAfter))
    parts.push(new Uint8Array([0]), e)
  }
  return keccak256(concatBytes(parts))
}

export const L1_DOMAIN = { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' } as const
export const AGENT_TYPES = { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] } as const

export function phantomAgent(hash: Hex, env: HlEnv) {
  return { source: env === 'mainnet' ? 'a' : 'b', connectionId: hash }
}

function splitSig(sig: Hex): Signature {
  const b = toBytes(sig)
  return { r: `0x${Buffer.from(b.slice(0, 32)).toString('hex')}` as Hex, s: `0x${Buffer.from(b.slice(32, 64)).toString('hex')}` as Hex, v: b[64]! }
}

/** Sign an L1 action (orders, cancels, leverage). Throws MainnetSigningBlockedError for anything but testnet. */
export async function signL1Action(account: LocalAccount, action: unknown, nonce: number, env: HlEnv, vaultAddress: string | null = null, expiresAfter?: number | null): Promise<Signature> {
  assertSigningAllowed(env, 'signL1Action')
  return signL1ActionUnchecked(account, action, nonce, env, vaultAddress, expiresAfter)
}

/** Internal: used only by fixture tests to compare with the official python SDK vectors (which cover mainnet source 'a').
 * NOT exported from the package entrypoint for runtime use by apps — see exchange.ts which always goes through signL1Action. */
export async function signL1ActionUnchecked(account: LocalAccount, action: unknown, nonce: number, env: HlEnv, vaultAddress: string | null = null, expiresAfter?: number | null): Promise<Signature> {
  const hash = actionHash(action, vaultAddress, nonce, expiresAfter)
  const sig = await account.signTypedData!({ domain: L1_DOMAIN, types: AGENT_TYPES, primaryType: 'Agent', message: phantomAgent(hash, env) as { source: string; connectionId: Hex } })
  return splitSig(sig)
}

export async function recoverL1Signer(action: unknown, sig: Signature, nonce: number, env: HlEnv, vaultAddress: string | null = null, expiresAfter?: number | null) {
  const hash = actionHash(action, vaultAddress, nonce, expiresAfter)
  const full = `${sig.r}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, '0')}` as Hex
  return recoverTypedDataAddress({ domain: L1_DOMAIN, types: AGENT_TYPES, primaryType: 'Agent', message: phantomAgent(hash, env) as { source: string; connectionId: Hex }, signature: full })
}

/** EIP-712 typed data for approveAgent (user-signed action). The MASTER wallet signs this in its own wallet UI (browser). */
export const APPROVE_AGENT_TYPES = {
  'HyperliquidTransaction:ApproveAgent': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const

export function approveAgentTypedData(agentAddress: Hex, agentName: string, nonce: number, env: HlEnv, signatureChainId: Hex = '0x66eee') {
  assertSigningAllowed(env, 'approveAgentTypedData')
  return {
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: Number.parseInt(signatureChainId, 16), verifyingContract: '0x0000000000000000000000000000000000000000' as Hex },
    types: APPROVE_AGENT_TYPES,
    primaryType: 'HyperliquidTransaction:ApproveAgent' as const,
    message: { hyperliquidChain: 'Testnet', agentAddress, agentName, nonce: BigInt(nonce) },
    action: { type: 'approveAgent', signatureChainId, hyperliquidChain: 'Testnet', agentAddress, agentName, nonce },
  }
}

export { splitSig }
