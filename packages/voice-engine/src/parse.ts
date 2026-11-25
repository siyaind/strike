/** Deterministic voice-intent grammar. No LLM guesses account, instrument, quantity or leverage. */
export type Intent =
  | { type: 'nav'; action: 'back' | 'next' | 'previous' | 'details' | 'cancel' | 'home' }
  | { type: 'radar'; category: 'positions' | 'watchlist' | 'trending' | 'movers' | 'funding' | 'all' }
  | { type: 'why'; coin: string }
  | { type: 'dna'; coin: string }
  | { type: 'chart'; coin: string; interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' }
  | { type: 'liquidity'; coin: string }
  | { type: 'position'; coin: string | null }
  | { type: 'liq-distance'; coin: string | null }
  | { type: 'protection'; coin: string | null }
  | { type: 'largest-exposure' }
  | { type: 'funding'; coin: string | null; scope: 'cost' | 'history' | 'today' | 'most' }
  | { type: 'scenario'; coin: string | null; pct: number }
  | { type: 'shadow'; coin: string; side: 'long' | 'short'; notionalUsd: number; leverage: number }
  | { type: 'compare-leverage'; a: number; b: number }
  | { type: 'prepare-order'; coin: string; market: 'perp' | 'spot'; side: 'long' | 'short' | 'buy' | 'sell'; notionalUsd: number; leverage: number }
  | { type: 'close-fraction'; coin: string | null; fraction: number; side: 'long' | 'short' | null }
  | { type: 'prepare-stop'; coin: string | null; pctFromEntry: number }
  | { type: 'replay'; coin: string | null; scope: 'last-trade' | 'position' | 'market' }
  | { type: 'modify'; notionalUsd?: number; leverage?: number }
  | { type: 'confirm-refused' }
  | { type: 'clarify'; question: string; missing: string[] }
  | { type: 'unknown'; text: string }

export interface VoiceContext { coin: string | null; screen: string; positions: string[]; lastIntent: Intent | null; knownCoins: string[] }

const NAMES: Record<string, string> = { bitcoin: 'BTC', btc: 'BTC', ether: 'ETH', ethereum: 'ETH', eth: 'ETH', solana: 'SOL', sol: 'SOL', hype: 'HYPE', hyperliquid: 'HYPE', arbitrum: 'ARB', avalanche: 'AVAX', chainlink: 'LINK', link: 'LINK', doge: 'DOGE', dogecoin: 'DOGE', sui: 'SUI', xrp: 'XRP', ripple: 'XRP' }
const WORDNUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twenty_five: 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "five hundred" → 500, "two thousand five hundred" → 2500, "twenty five" → 25 */
export function wordsToNumbers(s: string): string {
  return s.replace(/\b((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and))*)\b/g, (m) => {
    const parts = m.split(/[\s-]+/).filter((w) => w !== 'and')
    if (!parts.length || (parts.length === 1 && (parts[0] === 'hundred' || parts[0] === 'thousand'))) return m
    let total = 0, cur = 0
    for (const w of parts) {
      if (w === 'hundred') cur = (cur || 1) * 100
      else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0 }
      else cur += WORDNUM[w] ?? 0
    }
    return String(total + cur)
  })
}

function findCoins(t: string, known: string[]): string[] {
  const out: string[] = []
  const knownSet = new Set(known.map((k) => k.toUpperCase()))
  for (const tok of t.split(/[^a-z0-9]+/)) {
    if (!tok) continue
    const n = NAMES[tok]
    if (n && !out.includes(n)) { out.push(n); continue }
    const up = tok.toUpperCase()
    if (tok.length >= 2 && knownSet.has(up) && !out.includes(up) && !STOP.has(tok)) out.push(up)
  }
  return out
}
const STOP = new Set(['me', 'my', 'a', 'at', 'to', 'is', 'it', 'on', 'of', 'in', 'up', 'go', 'or', 'by', 'show', 'what', 'how', 'the', 'and', 'for', 'buy', 'sell', 'long', 'short', 'stop', 'half', 'back', 'next', 'more', 'use', 'make', 'close', 'order', 'book', 'one', 'hour', 'day', 'x', 'pay', 'cost', 'last', 'trade', 'only', 'why', 'which', 'were', 'are', 'am', 'i', 'we', 'you', 'far', 'from', 'whats', 'top', 'new', 'all', 'size', 'any', 'big', 'now', 'just', 'run'])

const num = (s: string | undefined) => (s == null ? null : Number(s.replace(/,/g, '')))

export function parseCommand(raw: string, ctx: VoiceContext): Intent {
  const t0 = raw.toLowerCase().replace(/[’']/g, '').replace(/[?!.]+$/g, '').trim()
  const t = wordsToNumbers(t0).replace(/\s+/g, ' ')
  const coins = findCoins(t, ctx.knownCoins)
  const coin = coins[0] ?? null
  const ctxCoin = coin ?? ctx.coin
  const money = num(t.match(/\$\s?([\d,]+(?:\.\d+)?)/)?.[1] ?? t.match(/([\d,]+(?:\.\d+)?)\s?(?:dollars?|usd|usdc|bucks)\b/)?.[1])
  const lev = num(t.match(/(\d+(?:\.\d+)?)\s?x\b/)?.[1] ?? t.match(/(\d+(?:\.\d+)?)\s?times leverage/)?.[1] ?? t.match(/leverage (?:of )?(\d+(?:\.\d+)?)/)?.[1])
  const pct = num(t.match(/(\d+(?:\.\d+)?)\s?(?:%|percent|per cent)/)?.[1])

  // Voice can NEVER authorise execution.
  if (/\b(confirm|execute|submit|place it|send it|do it|yes(,)? (buy|sell))\b/.test(t)) return { type: 'confirm-refused' }

  if (/^(go )?back$/.test(t)) return { type: 'nav', action: 'back' }
  if (/^(cancel|cancel (the )?preview|never mind|stop that)$/.test(t)) return { type: 'nav', action: 'cancel' }
  if (/^next( position| one)?$/.test(t)) return { type: 'nav', action: 'next' }
  if (/^previous( position| one)?$/.test(t)) return { type: 'nav', action: 'previous' }
  if (/^(show )?(me )?(the )?(details|more)$/.test(t)) return { type: 'nav', action: 'details' }
  if (/^(home|go home|main menu)$/.test(t)) return { type: 'nav', action: 'home' }

  if (/^(make it|change (it )?to|instead)/.test(t) || (/^use\b/.test(t) && lev != null)) {
    if (money == null && lev == null) return { type: 'clarify', question: 'Change the amount or the leverage?', missing: ['amount|leverage'] }
    return { type: 'modify', ...(money != null ? { notionalUsd: money } : {}), ...(lev != null ? { leverage: lev } : {}) }
  }
  if (/compare .*lever/.test(t) || /compare \d+x? (and|vs|versus|with) \d+x?/.test(t)) {
    const ns = [...t.matchAll(/(\d+(?:\.\d+)?)\s?x?/g)].map((m) => Number(m[1]))
    if (ns.length >= 2) return { type: 'compare-leverage', a: ns[0]!, b: ns[1]! }
  }
  if (/\bwhy\b.*\b(radar|here|showing|on)\b/.test(t)) return coin ? { type: 'why', coin } : { type: 'clarify', question: 'Which market?', missing: ['coin'] }
  if (/\b(radar|trending|movers|moving)\b/.test(t) || /only show my watchlist|show my watchlist/.test(t)) {
    const category = /watchlist/.test(t) ? 'watchlist' : /trending/.test(t) ? 'trending' : /moving positions|my positions/.test(t) ? 'positions' : /movers|moving/.test(t) ? 'movers' : /funding/.test(t) ? 'funding' : 'all'
    return { type: 'radar', category }
  }
  if (/market dna|\bdna\b|fingerprint/.test(t)) return ctxCoin ? { type: 'dna', coin: ctxCoin } : { type: 'clarify', question: 'DNA for which market?', missing: ['coin'] }
  if (/how liquid|liquidity|order ?book|depth/.test(t)) return ctxCoin ? { type: 'liquidity', coin: ctxCoin } : { type: 'clarify', question: 'Which market?', missing: ['coin'] }
  if (/replay|how did .* change|show how my/.test(t)) return { type: 'replay', coin: ctxCoin, scope: /last .*trade/.test(t) ? 'last-trade' : /position|my/.test(t) ? 'position' : 'market' }
  if (/(price )?(movement|chart|candles)/.test(t) && !/position/.test(t)) {
    const iv = t.match(/\b(1|one|5|15|4)[ -]?(minute|min|hour|hr|day)\b/)
    const map: Record<string, '1m' | '5m' | '15m' | '1h' | '4h' | '1d'> = { '1minute': '1m', '1min': '1m', '5minute': '5m', '5min': '5m', '15minute': '15m', '15min': '15m', '1hour': '1h', '1hr': '1h', '4hour': '4h', '4hr': '4h', '1day': '1d' }
    const interval = iv ? map[`${iv[1]}${iv[2]}`] ?? '1h' : '1h'
    return ctxCoin ? { type: 'chart', coin: ctxCoin, interval } : { type: 'clarify', question: 'Chart for which market?', missing: ['coin'] }
  }
  if (/how far .* liquidation|liquidation distance|close to liquidation/.test(t)) return { type: 'liq-distance', coin: ctxCoin }
  if (/protective|protection|my stops/.test(t) && /show|what|list/.test(t)) return { type: 'protection', coin: ctxCoin }
  if (/largest exposure|biggest (position|exposure)/.test(t)) return { type: 'largest-exposure' }
  if (/funding/.test(t)) return { type: 'funding', coin: /which of my positions/.test(t) ? null : ctxCoin, scope: /history/.test(t) ? 'history' : /today/.test(t) ? 'today' : /which .* most|paying the most/.test(t) ? 'most' : 'cost' }
  if (/what (happens|if)|if .* (drops|falls|rises|goes up|goes down|pumps|dumps)/.test(t) && pct != null && !/close/.test(t)) {
    const down = /(drop|fall|down|dump|lose|decline)/.test(t)
    return { type: 'scenario', coin: ctxCoin, pct: down ? -pct : pct }
  }
  if (/prepare (a )?stop|set (a )?stop|add (a )?stop|protective stop/.test(t)) {
    if (pct == null) return { type: 'clarify', question: 'How far from entry should the stop be?', missing: ['pct'] }
    return { type: 'prepare-stop', coin: ctxCoin, pctFromEntry: /above/.test(t) ? pct : -pct }
  }
  if (/\bclose\b|\breduce\b/.test(t)) {
    const frac = /\bhalf\b/.test(t) ? 0.5 : /quarter/.test(t) ? 0.25 : /three quarters/.test(t) ? 0.75 : /\ball\b|entire|whole|everything|full/.test(t) ? 1 : pct != null ? pct / 100 : /impact of closing/.test(t) ? 0.5 : null
    if (frac == null || frac <= 0 || frac > 1) return { type: 'clarify', question: 'Close how much — 25, 50, 75 or 100 percent?', missing: ['fraction'] }
    const c = coin ?? (ctx.coin && ctx.positions.includes(ctx.coin) ? ctx.coin : ctx.positions.length === 1 ? ctx.positions[0]! : null)
    if (!c && ctx.positions.length > 1) return { type: 'clarify', question: `Which position: ${ctx.positions.join(', ')}?`, missing: ['coin'] }
    return { type: 'close-fraction', coin: c, fraction: frac, side: /\bshort\b/.test(t) ? 'short' : /\blong\b/.test(t) ? 'long' : null }
  }
  const side = /\bshort\b/.test(t) ? 'short' : /\blong\b/.test(t) ? 'long' : /\bbuy\b/.test(t) ? 'buy' : /\bsell\b/.test(t) ? 'sell' : null
  if (side && (/\bprepare\b|\bopen\b|\bplace\b/.test(t) || /would look like|show me a|simulate/.test(t))) {
    const missing = [!ctxCoin && 'coin', money == null && 'amount'].filter(Boolean) as string[]
    if (missing.length) return { type: 'clarify', question: `Missing ${missing.join(' and ')} — e.g. "$100 BTC long at 2x".`, missing }
    const isSpot = /\bspot\b/.test(t)
    const leverage = isSpot ? 1 : lev ?? null
    if (leverage == null) return { type: 'clarify', question: 'What leverage? (e.g. "at 2x")', missing: ['leverage'] }
    if (/would look like|show me a|simulate/.test(t)) return { type: 'shadow', coin: ctxCoin!, side: side === 'buy' ? 'long' : side === 'sell' ? 'short' : side, notionalUsd: money!, leverage }
    return { type: 'prepare-order', coin: ctxCoin!, market: isSpot ? 'spot' : 'perp', side, notionalUsd: money!, leverage }
  }
  if (/position/.test(t) || (/^show (my )?\w+$/.test(t) && coin)) return { type: 'position', coin: ctxCoin }
  return { type: 'unknown', text: raw }
}
