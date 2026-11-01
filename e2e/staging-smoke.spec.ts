import { expect, test } from '@playwright/test'

test.describe('staging smoke', () => {
  test.skip(!process.env.STAGING_URL, 'STAGING_URL is not set')
  test.use({ serviceWorkers: 'block' })

  test('loads with the STAGING banner and no console errors', async ({ page }) => {
    const problems: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`))

    const response = await page.goto('./', { waitUntil: 'networkidle' })
    expect(response?.ok()).toBe(true)

    await expect(page.getByText(/STAGING/).first()).toBeVisible()
    expect(problems).toEqual([])
  })

  test('serves a build id', async ({ request }) => {
    const res = await request.get('build.json', { headers: { 'cache-control': 'no-cache' } })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.env).toBe('staging')
    expect(body.sha).toMatch(/^[0-9a-f]{40}$/)
  })
})
