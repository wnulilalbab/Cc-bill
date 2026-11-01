import { defineConfig } from '@playwright/test'

// STAGING_URL, e.g. https://wnulilalbab.github.io/Cc-bill/staging/ (trailing slash matters for relative asset URLs).
const baseURL = process.env.STAGING_URL

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: 0, // a flaky test is quarantined and reported, never retried until green
  reporter: [['list']],
  use: {
    baseURL,
    // Bypass the service-worker cache so we always test what was just deployed.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
})
