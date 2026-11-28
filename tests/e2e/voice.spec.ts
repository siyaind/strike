import { expect, test } from '@playwright/test'

const shots = process.env.E2E_SHOTS ?? 'evidence/e2e/screens'

/** Browser speech (Web Speech API) with a mocked webkitSpeechRecognition that "hears" a fixed phrase. */
function mockSpeech(phrase: string) {
  return (p: string) => {
    class Rec { lang = ''; interimResults = false; continuous = false; maxAlternatives = 1; onresult: any; onerror: any; onend: any
      start() { setTimeout(() => { const r: any = [{ transcript: p, confidence: 0.92 }]; r.isFinal = true; this.onresult?.({ resultIndex: 0, results: [r] }); this.onend?.() }, 150) }
      stop() {} }
    ;(window as any).webkitSpeechRecognition = Rec; (window as any).SpeechRecognition = Rec
  }
}

test('voice: browser speech → intent for review; spoken "confirm" is refused', async ({ page }) => {
  await page.addInitScript(mockSpeech(''), 'confirm the order')
  await page.goto('/voice')
  await expect(page.getByTestId('stt-status')).toContainText('available (free, Web Speech API)')
  await page.getByTestId('mic').click()
  await expect(page.getByTestId('intent')).toContainText('confirm-refused')
  await expect(page.getByText('Voice cannot authorise execution')).toBeVisible()
  await expect(page.getByText('browser-stt').first()).toBeVisible()
  await page.screenshot({ path: `${shots}/voice-browser-stt.png`, fullPage: true })
})

test('voice: typed fallback when the browser has no speech recognition', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).webkitSpeechRecognition; delete (window as any).SpeechRecognition })
  await page.goto('/voice')
  await expect(page.getByTestId('stt-status')).toContainText('not supported')
  await expect(page.getByTestId('mic')).toHaveCount(0)
  await page.getByLabel('Command').fill('what happens if BTC falls five percent')
  await page.getByRole('button', { name: 'Parse' }).click()
  await expect(page.getByTestId('intent')).toContainText('scenario')
})
