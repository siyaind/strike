import { expect, test } from '@playwright/test'

const shots = 'evidence/e2e/screens'

test('landing renders brand, CTA and safety copy', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the market')
  await expect(page.getByRole('link', { name: /guest demo/i })).toBeVisible()
  await expect(page.getByText(/Testnet-only signing/)).toBeVisible()
  await page.screenshot({ path: `${shots}/landing.png`, fullPage: true })
})

test('guest workspace shows SIMULATED labels, positions and radar from recorded live data', async ({ page }) => {
  await page.goto('/demo')
  await expect(page.getByText('SIMULATED ACCOUNT').first()).toBeVisible()
  await expect(page.getByText('BTC').first()).toBeVisible()
  await expect(page.getByText(/UNPROTECTED/).first()).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.screenshot({ path: `${shots}/workspace.png`, fullPage: true })
})

test('asset page: DNA, lens sizing, shadow → preview → confirm SIMULATED; duplicate confirm impossible', async ({ page }) => {
  await page.goto('/asset/BTC')
  await expect(page.getByText('Market DNA')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Momentum' })).toBeVisible()
  await page.getByRole('button', { name: '$100', exact: true }).click()
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByText('Est. entry')).toBeVisible()
  await page.getByRole('button', { name: 'Preview order' }).click()
  await expect(page.getByText('Order preview')).toBeVisible()
  await expect(page.getByText('SIMULATED EXECUTION').first()).toBeVisible()
  await page.screenshot({ path: `${shots}/asset-preview.png`, fullPage: true })
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByTestId('receipt')).toContainText(/FILLED/)
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
})

test('position orbit: add a stop to unprotected ETH → verified PROTECTED', async ({ page }) => {
  await page.goto('/positions')
  const eth = page.locator('section', { hasText: 'ETH' }).filter({ hasText: 'UNPROTECTED' }).first()
  await expect(eth).toBeVisible()
  const markTxt = await eth.locator('text=Mark').locator('..').locator('.num').innerText()
  const mark = Number(markTxt.replace(/,/g, ''))
  await eth.getByLabel('Stop price').fill(String(Math.round(mark * 1.05)))
  await eth.getByRole('button', { name: 'Add protective stop' }).click()
  await expect(page.getByText(/Verified: PROTECTED/)).toBeVisible()
  await page.screenshot({ path: `${shots}/orbit.png`, fullPage: true })
})

test('voice studio: voice can never confirm', async ({ page }) => {
  await page.goto('/voice')
  await page.getByRole('button', { name: 'Confirm the order' }).click()
  await expect(page.getByTestId('intent')).toContainText('confirm-refused')
  await page.getByRole('button', { name: 'What happens if BTC falls five percent?' }).click()
  await expect(page.getByTestId('intent')).toContainText('"pct": -5')
})

test('devices: pairing code is 6 digits', async ({ page }) => {
  await page.goto('/devices')
  await page.getByRole('button', { name: 'Generate pairing code' }).click()
  await expect(page.getByTestId('pair-code')).toHaveText(/^\d{6}$/)
})

test('diagnostics: testnet-only signing and no secrets', async ({ page }) => {
  await page.goto('/diagnostics')
  await expect(page.getByTestId('diag')).toContainText('testnet-only')
  const txt = await page.getByTestId('diag').innerText()
  expect(txt).not.toMatch(/CG-|secret|privateKey/i)
})

test('radar categories and explanations', async ({ page }) => {
  await page.goto('/radar')
  await expect(page.getByText('Universe')).toBeVisible()
  await page.getByRole('button', { name: /^movers/ }).click()
  await expect(page.getByText(/vs 24h-ago price/).first()).toBeVisible()
  await page.screenshot({ path: `${shots}/radar.png`, fullPage: true })
})
