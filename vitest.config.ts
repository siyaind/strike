import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['default', 'json'],
    outputFile: { json: 'evidence/unit-tests/vitest-results.json' },
  },
})
