import type { Frame, RenderMetrics } from '@strike/visual-engine'
import type { StrikeApi } from './api'
import type { Controller, Input } from './controller'
import { startWebSpeech, webSpeechSupported } from '@strike/voice-engine/webspeech'

/** Phone-side WebView UI: pairing entry + a pixel mirror of what the glasses show (useful for demos and debugging). */
export function mountPhone(root: HTMLElement, api: StrikeApi, ctl: Controller) {
  root.innerHTML = `<main>
    <h1>STRIKE <b>G2</b></h1>
    <div class="muted">Hyperliquid instruments on your glasses. <span class="tag" id="mode">GUEST DEMO · SIMULATED</span></div>
    <canvas id="mirror" width="576" height="288"></canvas>
    <div class="row"><button data-i="up">▲</button><button data-i="down">▼</button><button data-i="tap">TAP</button><button data-i="double">DOUBLE</button></div>
    <h3>Voice command</h3>
    <div class="muted">Free browser speech (Web Speech API) when this WebView supports it, otherwise type. Shown on the glasses for review — voice never confirms a trade.</div>
    <div class="row"><input id="vtext" placeholder="e.g. what if BTC falls 5 percent" style="flex:1"/><button id="vsend">Send</button><button id="vmic" hidden>🎙 Speak</button></div>
    <h3>Pair a real account</h3>
    <div class="row"><input id="code" inputmode="numeric" maxlength="6" placeholder="6-digit code from companion"/><button id="pair">Pair</button></div>
    <pre id="status"></pre>
  </main>`
  const cv = root.querySelector<HTMLCanvasElement>('#mirror')!
  const g = cv.getContext('2d')!
  const status = root.querySelector<HTMLPreElement>('#status')!
  root.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => b.addEventListener('click', () => void ctl.input(b.dataset.i as Input)))
  const vtext = root.querySelector<HTMLInputElement>('#vtext')!, vmic = root.querySelector<HTMLButtonElement>('#vmic')!
  const sendVoice = async (t: string, source: 'typed' | 'browser-stt', c: number | null = null) => { try { await ctl.voiceText(t, source, c) } catch (e) { status.textContent = `Voice failed: ${(e as Error).message}` } }
  root.querySelector('#vsend')!.addEventListener('click', () => void sendVoice(vtext.value, 'typed'))
  if (webSpeechSupported(window)) {
    vmic.hidden = false
    vmic.addEventListener('click', async () => {
      vmic.disabled = true; vmic.textContent = 'Listening…'
      try { const r = await startWebSpeech({ global: window, onInterim: (t) => { vtext.value = t } }).done; vtext.value = r.text; await sendVoice(r.text, 'browser-stt', r.confidence) }
      catch (e) { status.textContent = (e as Error).message } finally { vmic.disabled = false; vmic.textContent = '🎙 Speak' }
    })
  }
  root.querySelector('#pair')!.addEventListener('click', async () => {
    const code = root.querySelector<HTMLInputElement>('#code')!.value.trim()
    try { await api.pair(code); status.textContent = 'Paired. Data now comes from your account.'; root.querySelector('#mode')!.textContent = 'PAIRED'; ctl.s.screen = 'welcome' } catch (e) { status.textContent = `Pairing failed: ${(e as Error).message}` }
  })
  return {
    mirror(f: Frame, header: string, footer: string, m: RenderMetrics) {
      g.fillStyle = '#000'; g.fillRect(0, 0, 576, 288)
      const img = g.createImageData(f.w, f.h)
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const v = f.get(x, y) * 17, i = (y * f.w + x) * 4; img.data[i] = 0; img.data[i + 1] = v; img.data[i + 2] = Math.round(v * 0.55); img.data[i + 3] = 255 }
      g.putImageData(img, 0, 38)
      g.fillStyle = '#4dff9a'; g.font = '14px ui-monospace, monospace'
      g.fillText(header.slice(0, 70), 4, 20)
      footer.split('\n').slice(0, 3).forEach((l, i) => g.fillText(l.slice(0, 72), 4, 206 + i * 27))
      status.textContent = `renders ${m.renders} · transfers ${m.transfers} · suppressed ${m.suppressed} · failures ${m.failures} · last ${m.lastTransferMs?.toFixed(0) ?? '—'}ms${m.lastError ? ' · ' + m.lastError : ''}`
    },
  }
}
