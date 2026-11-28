'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Frame } from '@strike/visual-engine'

const NAV = [
  ['/demo', 'Workspace'], ['/radar', 'Radar'], ['/positions', 'Orbit'], ['/risk', 'Risk Lab'], ['/replay', 'Replay'],
  ['/sentinel', 'Sentinel'], ['/voice', 'Voice'], ['/devices', 'Glasses'], ['/wallet', 'Wallet'], ['/diagnostics', 'Diagnostics'],
] as const

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname()
  return (
    <div className="min-h-screen grain">
      <header className="sticky top-0 z-20 border-b border-line bg-obsidian/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
          <Link href="/" className="font-display text-2xl tracking-tight">STRIKE<span className="text-lime">.</span><span className="ml-1 align-top text-xs text-ash num">G2</span></Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm" aria-label="Main">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={`whitespace-nowrap rounded-full px-3 py-1.5 transition ${path?.startsWith(href) ? 'bg-lime text-obsidian font-semibold' : 'text-ash hover:text-bone'}`}>{label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-7xl px-5 pb-10 pt-4 text-xs text-ash">
        Market data: Hyperliquid public API. Trending data <a className="underline hover:text-lime" href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">Powered by CoinGecko</a>. Simulated and testnet modes only; STRIKE never moves real funds.
      </footer>
    </div>
  )
}

export function Tag({ children, tone = 'lime' }: { children: ReactNode; tone?: 'lime' | 'ember' | 'amber' | 'ash' | 'mint' }) {
  const c = { lime: 'border-lime text-lime', ember: 'border-ember text-ember', amber: 'border-amber text-amber', ash: 'border-line text-ash', mint: 'border-mint text-mint' }[tone]
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 num text-[10px] font-semibold uppercase tracking-[.12em] ${c}`}>{children}</span>
}

export function Section({ kicker, title, right, children }: { kicker?: string; title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>{kicker && <div className="kicker mb-1">{kicker}</div>}<h2 className="font-display text-2xl leading-none">{title}</h2></div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-line bg-slate/40 p-3">
      <div className="kicker">{label}</div>
      <div className={`num mt-1 text-xl ${tone === 'pos' ? 'text-mint' : tone === 'neg' ? 'text-ember' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ash">{sub}</div>}
    </div>
  )
}

export function Freshness({ at, err }: { at: number | null; err: string | null }) {
  if (err) return <Tag tone="ember">Unavailable · {err.slice(0, 40)}</Tag>
  if (!at) return <Tag tone="ash">Loading</Tag>
  return <Tag tone="mint">Live · polled</Tag>
}

export function ErrorBox({ err }: { err: string | null }) {
  if (!err) return null
  return <div role="alert" className="rounded-xl border border-ember/50 bg-ember/10 p-3 text-sm text-ember">{err} — no data is shown rather than stale or invented values.</div>
}

/** Renders the exact 4-bit G2 frame (same code path as the glasses) as a glowing lime-on-black canvas. */
export function G2Canvas({ frame, label }: { frame: Frame | null; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c || !frame) return
    const g = c.getContext('2d')!; const img = g.createImageData(frame.w, frame.h)
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) { const v = frame.get(x, y) / 15, i = (y * frame.w + x) * 4; img.data[i] = Math.round(198 * v); img.data[i + 1] = Math.round(255 * v); img.data[i + 2] = Math.round(61 * v); img.data[i + 3] = 255 }
    g.putImageData(img, 0, 0)
  }, [frame])
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-black">
      <canvas ref={ref} width={576} height={144} className="block w-full [image-rendering:pixelated]" aria-label={label ?? 'G2 instrument preview'} />
      {label && <figcaption className="border-t border-line px-3 py-1.5 kicker">G2 view · {label}</figcaption>}
    </figure>
  )
}

export const usd = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) })}`)
export const pct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
export const px = (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(3) : v.toPrecision(4))
