export type MarkerKind = 'liq' | 'stop' | 'entry' | 'mark' | 'tp' | 'scenario'
export interface OrbitInput {
  coin: string; side: 'long' | 'short'; leverage: number
  entryPx: number; markPx: number | null
  liquidationPx: number | null; stopPx: number | null; takeProfitPx: number | null
  scenarioPx?: number | null
}
export interface OrbitMarker { kind: MarkerKind; px: number; x: number; clipped: 'left' | 'right' | null; labelRow: 0 | 1 }
export interface OrbitLayout {
  mode: 'linear' | 'focused'
  min: number; max: number; x0: number; x1: number
  markers: OrbitMarker[]
  missing: MarkerKind[]
  liqDistancePct: number | null // from mark (or entry if no mark), always positive
  liqDirection: 'below' | 'above' | null
  warnings: string[]
}

/** Linear price rail: price increases left → right for BOTH longs and shorts (no label flipping).
 *  If an extreme marker (liq/tp) would squeeze entry/mark/stop into < 20% of the rail, switch to a FOCUSED linear scale
 *  around the core markers; extreme markers are pinned to the edge and flagged `clipped` (drawn with a clip arrow + value). */
export function orbitLayout(p: OrbitInput, x0 = 16, x1 = 560): OrbitLayout {
  const warnings: string[] = []
  const all: Array<[MarkerKind, number | null | undefined]> = [['liq', p.liquidationPx], ['stop', p.stopPx], ['entry', p.entryPx], ['mark', p.markPx], ['tp', p.takeProfitPx], ['scenario', p.scenarioPx]]
  const present = all.filter((a): a is [MarkerKind, number] => typeof a[1] === 'number' && Number.isFinite(a[1]) && a[1] > 0)
  const missing = all.filter((a) => !(typeof a[1] === 'number' && a[1] > 0) && a[0] !== 'scenario').map((a) => a[0])
  const core = present.filter(([k]) => k === 'entry' || k === 'mark' || k === 'stop' || k === 'scenario').map(([, v]) => v)
  const allV = present.map(([, v]) => v)
  let lo = Math.min(...allV), hi = Math.max(...allV)
  const coreLo = Math.min(...core), coreHi = Math.max(...core)
  let mode: OrbitLayout['mode'] = 'linear'
  const coreSpan = Math.max(coreHi - coreLo, coreHi * 0.002)
  if ((hi - lo) > 0 && coreSpan / (hi - lo) < 0.2) {
    mode = 'focused'
    lo = coreLo - coreSpan * 0.6; hi = coreHi + coreSpan * 0.6
    warnings.push('Focused scale: some markers are beyond the rail edge (shown with clip arrows).')
  } else {
    const span = Math.max(hi - lo, hi * 0.002)
    lo -= span * 0.06; hi += span * 0.06
  }
  const scale = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0)
  const markers: OrbitMarker[] = present.map(([kind, px]) => {
    let x = scale(px), clipped: OrbitMarker['clipped'] = null
    if (x < x0) { x = x0; clipped = 'left' } else if (x > x1) { x = x1; clipped = 'right' }
    return { kind, px, x: Math.round(x), clipped, labelRow: 0 as 0 | 1 }
  }).sort((a, b) => a.x - b.x)
  // Overlap handling: alternate label rows when markers are closer than 44px.
  for (let i = 1; i < markers.length; i++) if (markers[i]!.x - markers[i - 1]!.x < 44) markers[i]!.labelRow = markers[i - 1]!.labelRow === 0 ? 1 : 0
  const ref = p.markPx ?? p.entryPx
  let liqDistancePct: number | null = null, liqDirection: OrbitLayout['liqDirection'] = null
  if (p.liquidationPx && p.liquidationPx > 0) {
    liqDistancePct = (Math.abs(ref - p.liquidationPx) / ref) * 100
    liqDirection = p.liquidationPx < ref ? 'below' : 'above'
    if ((p.side === 'long' && liqDirection === 'above') || (p.side === 'short' && liqDirection === 'below')) warnings.push('Liquidation price is on the unexpected side of mark — verify exchange data.')
  } else warnings.push('Liquidation price unavailable from exchange.')
  if (p.stopPx && ((p.side === 'long' && p.stopPx >= ref) || (p.side === 'short' && p.stopPx <= ref))) warnings.push('Stop is already through the current price.')
  return { mode, min: lo, max: hi, x0, x1, markers, missing, liqDistancePct, liqDirection, warnings }
}
