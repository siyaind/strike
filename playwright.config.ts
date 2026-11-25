import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'evidence/e2e/playwright-results.json' }]],
  use: { baseURL: 'http://localhost:3100', channel: process.env.PW_CHANNEL ?? 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: 'evidence/e2e/artifacts',
  webServer: [
    { command: 'cd apps/api && npx tsx src/fixture-server.ts', port: 8898, reuseExistingServer: false, timeout: 60_000 },
    { command: 'cd apps/companion && NEXT_PUBLIC_STRIKE_API=http://localhost:8898 NEXT_TELEMETRY_DISABLED=1 npx next build && npx next start -p 3100', port: 3100, reuseExistingServer: false, timeout: 240_000 },
  ],
})
