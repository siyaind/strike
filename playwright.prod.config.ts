import { defineConfig } from '@playwright/test'
// Runs the companion e2e suite against the LIVE production deployment (no local servers).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'evidence/deployment/playwright-prod-results.json' }]],
  use: { baseURL: process.env.PROD_WEB ?? 'https://strike-g2.vercel.app', ...(process.env.CI ? {} : { channel: 'chrome' }), storageState: 'evidence/deployment/.prod-state.json', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  globalSetup: './tests/e2e/prod-setup.ts',
  outputDir: 'evidence/deployment/playwright-artifacts',
})
