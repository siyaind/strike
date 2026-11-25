'use client'
import Link from 'next/link'
import { usePoll, useSession } from '@/lib/hooks'
import { ErrorBox, Freshness, Section, Tag } from '@/components/ui'

export default function Sentinel() {
  const { me } = useSession()
  const s = usePoll(me ? '/v1/sentinel/events' : null, 8000)
  return (
    <div className="space-y-6">
      <div><div className="kicker">Sentinel</div><h1 className="font-display text-5xl">What needs you now</h1></div>
      <ErrorBox err={s.err} />
      <Section kicker="Current events" title={`${s.data?.events?.length ?? 0} open`} right={<Freshness at={s.at} err={s.err} />}>
        <ul className="divide-y divide-line">{s.data?.events?.map((e: any) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
            <Tag tone={e.severity === 'CRITICAL' ? 'ember' : e.severity === 'WARNING' ? 'amber' : 'ash'}>{e.severity === 'CRITICAL' ? '◆' : e.severity === 'WARNING' ? '⚠' : 'i'} {e.severity}</Tag>
            <span className="flex-1">{e.reason}</span>
            {e.coin && <Link href={e.action === 'prepare-stop' ? '/positions' : `/asset/${e.coin}`} className="btn btn-ghost">{e.action === 'prepare-stop' ? 'Review protection' : 'Review'}</Link>}
          </li>))}</ul>
        {!s.data?.events?.length && <p className="text-ash">All clear.</p>}
        <p className="mt-3 text-xs text-ash">{s.data?.note}</p>
      </Section>
    </div>
  )
}
