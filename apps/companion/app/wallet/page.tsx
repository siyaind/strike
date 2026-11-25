'use client'
import { useState } from 'react'
import { api, setToken } from '@/lib/api'
import { useSession } from '@/lib/hooks'
import { ErrorBox, Section, Tag } from '@/components/ui'

declare global { interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<any> } } }

export default function Wallet() {
  const { me, refresh } = useSession()
  const [err, setErr] = useState<string | null>(null); const [watch, setWatch] = useState(''); const [env, setEnv] = useState<'testnet' | 'mainnet'>('testnet'); const [agent, setAgent] = useState<any>(null)
  async function connect() {
    setErr(null)
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Install an EIP-1193 wallet, or use watch-only.')
      const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const ch = await api('/v1/auth/challenge', { body: { address: addr }, auth: false })
      const sig = await window.ethereum.request({ method: 'personal_sign', params: [ch.message, addr] })
      const v = await api('/v1/auth/verify', { body: { challengeId: ch.challengeId, signature: sig }, auth: false })
      setToken(v.token); await refresh()
    } catch (e) { setErr((e as Error).message) }
  }
  async function watchOnly() { setErr(null); try { const v = await api('/v1/accounts/watch', { body: { address: watch, env }, auth: false }); setToken(v.token); await refresh() } catch (e) { setErr((e as Error).message) } }
  async function createAgent() {
    setErr(null)
    try {
      const a = await api('/v1/signers/agent', { method: 'POST' }); setAgent(a)
      if (!window.ethereum) throw new Error('A browser wallet is needed to approve the agent')
      const sig = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [me.address, JSON.stringify({ ...a.typedData, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...a.typedData.types } })] })
      await api('/v1/signers/agent/approve', { body: { signature: sig, nonce: a.nonce } }); await refresh()
    } catch (e) { setErr((e as Error).message) }
  }
  async function logout() { await api('/v1/auth/logout', { method: 'POST' }).catch(() => {}); setToken(null); await refresh() }
  return (
    <div className="space-y-6">
      <div><div className="kicker">Wallet &amp; security</div><h1 className="font-display text-5xl">Your keys stay yours</h1></div>
      <div className="flex flex-wrap gap-2">{me && <><Tag tone="ash">mode: {me.mode}</Tag>{me.address && <Tag tone="lime">{me.address.slice(0, 6)}…{me.address.slice(-4)}</Tag>}{me.accountEnv && <Tag tone="amber">{me.accountEnv}</Tag>}{me.signer && <Tag tone={me.signer.approved ? 'mint' : 'amber'}>agent {me.signer.approved ? 'approved' : 'pending'}</Tag>}</>}<button onClick={logout} className="btn btn-ghost text-xs">Sign out everywhere</button></div>
      <ErrorBox err={err} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section kicker="Mode C" title="Prove ownership">
          <p className="text-sm text-ash">Sign a one-time message (no transaction, no gas). STRIKE never asks for a seed phrase or private key.</p>
          <button onClick={connect} className="btn btn-lime mt-4">Connect wallet</button>
        </Section>
        <Section kicker="Mode B" title="Watch-only">
          <p className="text-sm text-ash">Read-only view of any address. Cannot trade.</p>
          <input aria-label="Address" value={watch} onChange={(e) => setWatch(e.target.value)} placeholder="0x…" className="mt-3 w-full num" />
          <div className="mt-2 flex gap-2"><select aria-label="Network" value={env} onChange={(e) => setEnv(e.target.value as any)}><option value="testnet">testnet</option><option value="mainnet">mainnet (read-only)</option></select><button onClick={watchOnly} className="btn btn-ghost">Watch</button></div>
        </Section>
        <Section kicker="Mode D" title="Testnet agent">
          <p className="text-sm text-ash">Creates a STRIKE agent key (encrypted server-side) that you approve with your wallet on <b>Hyperliquid testnet only</b>. Agents cannot withdraw or transfer.</p>
          <button disabled={me?.mode !== 'wallet'} onClick={createAgent} className="btn btn-lime mt-4">Create &amp; approve agent</button>
          {agent && <p className="num mt-2 text-xs text-ash">agent {agent.agentAddress}</p>}
        </Section>
      </div>
    </div>
  )
}
