import { chromium, type FullConfig } from '@playwright/test'
/** Production runs create ONE guest session and share it across tests, so the suite respects the API's per-IP guest-creation limit (5/min). */
export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' })
  const page = await browser.newPage()
  await page.goto(baseURL + '/demo')
  await page.waitForFunction(() => !!localStorage.getItem('strike.companion.token'), null, { timeout: 30_000 })
  await page.context().storageState({ path: 'evidence/deployment/.prod-state.json' })
  await browser.close()
}
