import { defineConfig } from '@playwright/test'
import { availableParallelism } from 'node:os'

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  // Every test owns its browser profile, extension copy, server and downloads.
  // Test-level parallelism also lets CI shards divide the largest spec files.
  fullyParallel: true,
  workers: process.env.CI ? 2 : Math.min(4, availableParallelism()),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: 'test-results/browser',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
})
