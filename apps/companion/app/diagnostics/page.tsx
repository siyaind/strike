'use client'
import { usePoll } from '@/lib/hooks'
import { API_BASE } from '@/lib/api'
import { ErrorBox, Freshness, Section } from '@/components/ui'

export default function Diagnostics() {
  const d = usePoll('/v1/diagnostics', 5000)
  const r = usePoll('/readyz', 10000)
  return (
    <div className="space-y-6">
      <div><div className="kicker">Diagnostics</div><h1 className="font-display text-5xl">Under the hood</h1></div>
      <ErrorBox err={d.err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section kicker={API_BASE} title="Readiness" right={<Freshness at={r.at} err={r.err} />}><pre className="num whitespace-pre-wrap text-xs text-ash">{JSON.stringify(r.data, null, 2)}</pre></Section>
        <Section kicker="Upstreams, budgets, sessions" title="Diagnostics" right={<Freshness at={d.at} err={d.err} />}><pre className="num whitespace-pre-wrap text-xs text-ash" data-testid="diag">{JSON.stringify(d.data, null, 2)}</pre></Section>
      </div>
    </div>
  )
}
