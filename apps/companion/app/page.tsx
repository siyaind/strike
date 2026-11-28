import Link from 'next/link'

const INSTRUMENTS = [
  ['Market Radar', 'Every Hyperliquid perp on one plane: 24h move × volume rank × open interest. Shapes, not shades, mark your positions, watchlist and funding stress.'],
  ['Market DNA', 'Six measured traits — momentum, volume, liquidity, volatility, funding, open interest — ranked against the live universe. Unavailable stays unavailable.'],
  ['Liquidity Lens', 'Mirrored cumulative depth from the visible book, with your order size drawn through it and slippage estimated before you act.'],
  ['Position Orbit', 'Liquidation, stop, entry, mark and target on one linear price rail. Scenario moves slide across it in real time.'],
  ['Shadow Trade', 'Simulate a trade against the live book: entry, fees, margin, funding and P&L under seven moves. Nothing is sent.'],
  ['Sentinel', 'Unprotected positions, liquidation proximity and stale data — surfaced while STRIKE is open. It alerts; it never trades.'],
]

export default function Landing() {
  return (
    <div className="space-y-16">
      <section className="grid items-end gap-10 pt-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="kicker mb-4">Even Realities × TVM · Heads Up · Crypto &amp; DeFi</div>
          <h1 className="font-display text-6xl leading-[0.95] tracking-tight md:text-8xl">Read the market<br /><em className="text-lime">without looking down.</em></h1>
          <p className="mt-6 max-w-xl text-lg text-ash">STRIKE turns Hyperliquid into instruments you can read at a glance on Even G2 glasses — and gives every number a source, a timestamp and a method.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="btn btn-lime">Open the guest demo →</Link>
            <Link href="/devices" className="btn btn-ghost">Pair your G2</Link>
          </div>
          <p className="mt-4 text-xs text-ash">Guest demo: simulated account, live public market data. No wallet, no sign-up, no real funds.</p>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-2"><span className="kicker">Illustration · G2 display 576 × 288</span><span className="num text-xs text-lime">● LIVE</span></div>
          <div className="aspect-[2/1] bg-black p-4 font-mono text-[11px] leading-5 text-lime/90">
            <div>STRIKE  ORBIT ETH  SHORT 5x  UNPROTECTED</div>
            <div className="mt-6 flex items-center gap-2"><span>SCEN</span><span className="h-px flex-1 bg-lime/70" /><span>◆ NOW</span><span className="h-px flex-1 bg-lime/70" /><span>△ LIQ</span></div>
            <div className="mt-6 text-lime/60">LIQ 1965 (approx) | PNL +$7.97</div>
            <div className="text-lime/60">If -10% → 1487: +$104.25 (hypothetical)</div>
            <div className="text-lime/60">Tap: next instrument | Double: back</div>
          </div>
        </div>
      </section>

      <section>
        <div className="kicker mb-4">Six instruments</div>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {INSTRUMENTS.map(([t, d], i) => (
            <div key={t} className="bg-onyx p-6">
              <div className="num text-xs text-lime">0{i + 1}</div>
              <h3 className="mt-2 font-display text-3xl">{t}</h3>
              <p className="mt-2 text-sm text-ash">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          ['Testnet-only signing', 'Signed Hyperliquid actions are blocked on mainnet in code, in three layers, and tested. No withdrawals, transfers or bridging exist in the codebase.'],
          ['You confirm, every time', 'Each order is a preview with a 30-second, single-use confirmation. Voice can navigate and prepare — it can never confirm.'],
          ['Honest numbers', 'Every value carries its source and age. If data is missing, STRIKE says so instead of guessing.'],
        ].map(([t, d]) => (
          <div key={t} className="border-t border-lime/40 pt-4"><h3 className="font-display text-2xl">{t}</h3><p className="mt-2 text-sm text-ash">{d}</p></div>
        ))}
      </section>
    </div>
  )
}
