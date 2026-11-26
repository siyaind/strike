# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: companion.spec.ts >> devices: pairing code is 6 digits
- Location: tests/e2e/companion.spec.ts:58:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('pair-code')
Expected pattern: /^\d{6}$/
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" getByTestId('pair-code') with timeout 5000ms
  - waiting for getByTestId('pair-code')

```

```yaml
- banner:
  - link "STRIKE.G2":
    - /url: /
  - navigation "Main":
    - link "Workspace":
      - /url: /demo
    - link "Radar":
      - /url: /radar
    - link "Orbit":
      - /url: /positions
    - link "Risk Lab":
      - /url: /risk
    - link "Replay":
      - /url: /replay
    - link "Sentinel":
      - /url: /sentinel
    - link "Voice":
      - /url: /voice
    - link "Glasses":
      - /url: /devices
    - link "Wallet":
      - /url: /wallet
    - link "Diagnostics":
      - /url: /diagnostics
- main:
  - text: Glasses
  - heading "Pair your G2" [level=1]
  - alert: Authentication required — no data is shown rather than stale or invented values.
  - text: Step 1
  - heading "Get a code" [level=2]
  - paragraph: Open STRIKE in the Even app on your phone and enter this 6-digit code. Codes are single-use and expire in 5 minutes.
  - button "Generate pairing code"
  - text: Paired
  - heading "Devices" [level=2]
  - list
  - paragraph: No paired glasses yet.
- contentinfo:
  - text: "Market data: Hyperliquid public API. Trending data"
  - link "Powered by CoinGecko":
    - /url: https://www.coingecko.com/en/api
  - text: . Simulated and testnet modes only; STRIKE never moves real funds.
- alert
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | 
  3  | const shots = process.env.E2E_SHOTS ?? 'evidence/e2e/screens'
  4  | 
  5  | test('landing renders brand, CTA and safety copy', async ({ page }) => {
  6  |   await page.goto('/')
  7  |   await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the market')
  8  |   await expect(page.getByRole('link', { name: /guest demo/i })).toBeVisible()
  9  |   await expect(page.getByText(/Testnet-only signing/)).toBeVisible()
  10 |   await page.screenshot({ path: `${shots}/landing.png`, fullPage: true })
  11 | })
  12 | 
  13 | test('guest workspace shows SIMULATED labels, positions and radar from recorded live data', async ({ page }) => {
  14 |   await page.goto('/demo')
  15 |   await expect(page.getByText('SIMULATED ACCOUNT').first()).toBeVisible()
  16 |   await expect(page.getByText('BTC').first()).toBeVisible()
  17 |   await expect(page.getByText(/UNPROTECTED/).first()).toBeVisible()
  18 |   await expect(page.locator('canvas').first()).toBeVisible()
  19 |   await page.screenshot({ path: `${shots}/workspace.png`, fullPage: true })
  20 | })
  21 | 
  22 | test('asset page: DNA, lens sizing, shadow → preview → confirm SIMULATED; duplicate confirm impossible', async ({ page }) => {
  23 |   await page.goto('/asset/BTC')
  24 |   await expect(page.getByText('Market DNA')).toBeVisible()
  25 |   await expect(page.getByRole('cell', { name: 'Momentum' })).toBeVisible()
  26 |   await page.getByRole('button', { name: '$100', exact: true }).click()
  27 |   await page.getByRole('button', { name: 'Simulate' }).click()
  28 |   await expect(page.getByText('Est. entry')).toBeVisible()
  29 |   await page.getByRole('button', { name: 'Preview order' }).click()
  30 |   await expect(page.getByText('Order preview')).toBeVisible()
  31 |   await expect(page.getByText('SIMULATED EXECUTION').first()).toBeVisible()
  32 |   await page.screenshot({ path: `${shots}/asset-preview.png`, fullPage: true })
  33 |   await page.getByRole('button', { name: 'Confirm' }).click()
  34 |   await expect(page.getByTestId('receipt')).toContainText(/FILLED/)
  35 |   await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
  36 | })
  37 | 
  38 | test('position orbit: add a stop to unprotected ETH → verified PROTECTED', async ({ page }) => {
  39 |   await page.goto('/positions')
  40 |   const eth = page.locator('section', { hasText: 'ETH' }).filter({ hasText: 'UNPROTECTED' }).first()
  41 |   await expect(eth).toBeVisible()
  42 |   const markTxt = await eth.locator('text=Mark').locator('..').locator('.num').innerText()
  43 |   const mark = Number(markTxt.replace(/,/g, ''))
  44 |   await eth.getByLabel('Stop price').fill(String(Math.round(mark * 1.05)))
  45 |   await eth.getByRole('button', { name: 'Add protective stop' }).click()
  46 |   await expect(page.getByText(/Verified: PROTECTED/)).toBeVisible()
  47 |   await page.screenshot({ path: `${shots}/orbit.png`, fullPage: true })
  48 | })
  49 | 
  50 | test('voice studio: voice can never confirm', async ({ page }) => {
  51 |   await page.goto('/voice')
  52 |   await page.getByRole('button', { name: 'Confirm the order' }).click()
  53 |   await expect(page.getByTestId('intent')).toContainText('confirm-refused')
  54 |   await page.getByRole('button', { name: 'What happens if BTC falls five percent?' }).click()
  55 |   await expect(page.getByTestId('intent')).toContainText('"pct": -5')
  56 | })
  57 | 
  58 | test('devices: pairing code is 6 digits', async ({ page }) => {
  59 |   await page.goto('/devices')
  60 |   await page.getByRole('button', { name: 'Generate pairing code' }).click()
> 61 |   await expect(page.getByTestId('pair-code')).toHaveText(/^\d{6}$/)
     |                                               ^ Error: expect(locator).toHaveText(expected) failed
  62 | })
  63 | 
  64 | test('diagnostics: testnet-only signing and no secrets', async ({ page }) => {
  65 |   await page.goto('/diagnostics')
  66 |   await expect(page.getByTestId('diag')).toContainText('testnet-only')
  67 |   const txt = await page.getByTestId('diag').innerText()
  68 |   expect(txt).not.toMatch(/CG-|secret|privateKey/i)
  69 | })
  70 | 
  71 | test('radar categories and explanations', async ({ page }) => {
  72 |   await page.goto('/radar')
  73 |   await expect(page.getByText('Universe')).toBeVisible()
  74 |   await page.getByRole('button', { name: /^movers/ }).click()
  75 |   await expect(page.getByText(/vs 24h-ago price/).first()).toBeVisible()
  76 |   await page.screenshot({ path: `${shots}/radar.png`, fullPage: true })
  77 | })
  78 | 
```