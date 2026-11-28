'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, Section, Tag } from '@/components/ui'

export default function Devices() {
  const { me } = useSession()
  const devs = usePoll(me ? '/v1/devices' : null, 5000)
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null); const [err, setErr] = useState<string | null>(null)
  async function start() { setErr(null); try { setCode(await api('/v1/pairing/start', { method: 'POST' })) } catch (e) { setErr((e as Error).message) } }
  async function revoke(id: string) { try { await api(`/v1/devices/${id}`, { method: 'DELETE' }); devs.reload() } catch (e) { setErr((e as Error).message) } }
  return (
    <div className="space-y-6">
      <div><div className="kicker">Glasses</div><h1 className="font-display text-5xl">Pair your G2</h1></div>
      <ErrorBox err={err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section kicker="Step 1" title="Get a code">
          <p className="text-sm text-ash">Open STRIKE in the Even app on your phone and enter this 6-digit code. Codes are single-use and expire in 5 minutes.</p>
          <button onClick={start} className="btn btn-lime mt-4">Generate pairing code</button>
          {code && <div className="mt-4 num text-5xl tracking-[.3em] text-lime" data-testid="pair-code">{code.code}</div>}
        </Section>
        <Section kicker="Paired" title="Devices">
          <ul className="divide-y divide-line">{(devs.data ?? []).map((d: any) => <li key={d.id} className="flex items-center justify-between py-2 text-sm"><span>{d.name} <span className="num text-ash">{d.id}</span></span>{d.revokedAt ? <Tag tone="ash">revoked</Tag> : <button onClick={() => revoke(d.id)} className="btn btn-ghost">Revoke</button>}</li>)}</ul>
          {!devs.data?.length && <p className="text-sm text-ash">No paired glasses yet.</p>}
        </Section>
      </div>
    </div>
  )
}
