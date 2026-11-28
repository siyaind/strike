#!/usr/bin/env node
// Drives the OFFICIAL Even Hub simulator through STRIKE flows via its automation API and stores
// raw glasses screenshots (PNG, alpha = lit pixels) + console logs as evidence.
// Prereqs (see docs/SIMULATOR.md): API on :8899, glasses dev server on :5180,
//   evenhub-simulator http://localhost:5180 --automation-port 9898
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIM = process.env.SIM_URL ?? 'http://localhost:9898'
const OUT = process.env.SIM_OUT ?? 'evidence/g2-simulator'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

let consoleId = 0
const allConsole = []
async function drainConsole() {
  const r = await fetch(`${SIM}/api/console?since_id=${consoleId}`).then((x) => x.json())
  for (const e of r.entries ?? []) { allConsole.push(e); consoleId = Math.max(consoleId, e.id) }
  return r.entries ?? []
}
async function input(action) {
  const r = await fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
  if (!r.ok) throw new Error(`input ${action}: HTTP ${r.status}`)
}
/** Wait until the app logs a render after our input (renders are logged by the app after image transfers complete). */
async function waitRender(timeoutMs = 15000, match = null) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const es = await drainConsole()
    const hit = es.filter((e) => /\[strike\] render/.test(e.message)).pop()
    if (hit && (!match || match.test(hit.message))) { await sleep(250); return hit.message }
    await sleep(150)
  }
  throw new Error(`timeout waiting for render${match ? ' ' + match : ''}`)
}
const steps = []
async function shot(name, note) {
  const buf = Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer())
  const file = `${String(steps.length + 1).padStart(2, '0')}-${name}.png`
  writeFileSync(join(OUT, file), buf)
  const last = allConsole.filter((e) => /\[strike\] render/.test(e.message)).pop()?.message ?? null
  steps.push({ file, name, note, at: new Date().toISOString(), lastRender: last })
  console.log('✓', file, '—', last?.slice(0, 120))
}
async function act(action, name, note, match) { await input(action); const m = await waitRender(15000, match); await shot(name, note); return m }

const started = new Date().toISOString()
let failed = null
try {
  if ((await (await fetch(`${SIM}/api/ping`)).text()).trim() !== 'pong') throw new Error('simulator not reachable')
  await drainConsole()
  // Reset to welcome by double-tapping is not possible (exits); script expects a freshly launched simulator.
  await shot('A-welcome', 'Flow A: welcome screen, startup container created')
  await act('click', 'A-hub', 'Flow A: guest demo session created → hub', /HOME/)
  await act('click', 'B-radar', 'Flow B: Market Radar with live public Hyperliquid data', /RADAR/)
  await act('down', 'B-radar-next', 'Flow B: swipe selects next radar item', /RADAR\s+2\//)
  await act('down', 'B-radar-next2', 'Flow B: swipe again', /RADAR\s+3\//)
  const m = await act('click', 'C-first-instrument', 'Flow C: open selected market (Orbit if position, else DNA)', /(ORBIT|DNA)/)
  if (/ORBIT/.test(m)) { await act('down', 'F-orbit-scenario', 'Flow F: Position Orbit scenario -10%', /ORBIT/); await act('click', 'C-dna', 'Flow C: Market DNA', /DNA/) }
  await act('down', 'C-dna-axis', 'Flow C: DNA axis selection', /DNA/)
  await act('click', 'D-lens', 'Flow D: Liquidity Lens, $100', /LENS/)
  await act('down', 'D-lens-250', 'Flow D: Liquidity Lens size → $250', /\$250/)
  await act('click', 'E-shadow', 'Flow E: Shadow Trade at $250', /SHADOW/)
  await act('up', 'E-shadow-scenario', 'Flow E: scenario -2%', /SHADOW/)
  await act('up', 'E-shadow-scenario2', 'Flow E: scenario -5%', /SHADOW/)
  for (let i = 0; i < 7; i++) { await input('down'); await waitRender(15000, /SHADOW/) } // idx 1 (-5%) → idx 8 (PREVIEW ORDER)
  await shot('G-shadow-preview-option', 'Flow G: PREVIEW ORDER option selected')
  await act('click', 'G-preview', 'Flow G: order preview, CANCEL selected by default', /PREVIEW/)
  await act('click', 'G-preview-cancelled', 'Flow G: tap on default cancels (no order)', /SHADOW/)
  await act('click', 'G-preview-again', 'Flow G: preview again', /PREVIEW/)
  await act('down', 'G-preview-confirm-selected', 'Flow G: swipe to CONFIRM', /PREVIEW/)
  await act('click', 'G-receipt', 'Flow G: SIMULATED execution receipt', /RECEIPT/)
  await act('click', 'G-back-to-shadow', 'Flow G: back from receipt', /SHADOW/)
  await act('click', 'E-funding', 'Flow E: Funding Clock', /FUNDING/)
  await act('double_click', 'H-back-radar', 'Back to radar', /RADAR/)
  await act('double_click', 'H-back-hub', 'Back to hub', /HOME/)
  await act('down', 'H-hub-positions', 'Hub: POSITIONS selected', /HOME/)
  await act('click', 'F-positions', 'Flow F: positions list with protection state', /POSITIONS/)
  await act('click', 'F-orbit', 'Flow F: Position Orbit', /ORBIT/)
  await act('double_click', 'F-back', 'back', /POSITIONS/)
  await act('double_click', 'H-hub', 'back to hub', /HOME/)
  await act('down', 'H-hub-sentinel', 'Hub: SENTINEL selected', /HOME/)
  await act('click', 'H-sentinel', 'Flow H: Sentinel events (unprotected ETH)', /SENTINEL/)
  await act('double_click', 'H-hub2', 'back to hub', /HOME/)
  await act('down', 'I-hub-voice', 'Hub: VOICE selected', /HOME/)
  await act('click', 'I-voice', 'Flow I: voice — simulator has no G2 mic events; honest unavailable message', /VOICE/)
} catch (e) { failed = String(e?.stack ?? e); console.error(e) }
await drainConsole().catch(() => {})
const errors = allConsole.filter((e) => e.level === 'error')
const result = { tool: '@evenrealities/evenhub-simulator automation API', simulator: SIM, started, finished: new Date().toISOString(), ok: !failed, failed, steps, consoleErrors: errors, imageFailures: allConsole.filter((e) => /"failures":[1-9]/.test(e.message)).length }
writeFileSync(join(OUT, 'sim-run.json'), JSON.stringify(result, null, 2))
writeFileSync(join(OUT, 'console.log.json'), JSON.stringify(allConsole, null, 2))
console.log(failed ? `FAILED after ${steps.length} steps` : `OK — ${steps.length} screenshots`, `console errors: ${errors.length}`)
process.exit(failed ? 1 : 0)
