import { defineConfig, devices } from '@playwright/test'

// The Phase 1 full scenario run (e2e/phase1.spec.ts) against `vite preview` of a STAGING build, on a 390px phone
// viewport. Synthetic fixtures only; the AI is mocked by route interception and no request leaves localhost.
const PORT = 4179
const BASE = '/Cc-bill/staging/'

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'phase1.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0, // a flaky test is quarantined and reported, never retried until green
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    baseURL: `http://localhost:${PORT}${BASE}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  },
  webServer: {
    // CI builds staging just before this step (PHASE1_PREBUILT=1): then only serve that build.
    command: `${process.env.PHASE1_PREBUILT ? '' : 'npm run build && '}npx vite preview --port ${PORT} --strictPort`,
    env: { VITE_APP_ENV: 'staging', VITE_BASE: BASE },
    url: `http://localhost:${PORT}${BASE}`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
