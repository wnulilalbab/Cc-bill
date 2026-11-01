import { defineConfig } from '@playwright/test'

// STAGING_URL, e.g. https://wnulilalbab.github.io/Cc-bill/staging/ (trailing slash matters for relative asset URLs).
const baseURL = process.env.STAGING_URL

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // The Phase 1 scenario run has its own config (local staging build, mocked AI): npm run test:e2e:phase1.
  testIgnore: '**/phase1.spec.ts',
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
