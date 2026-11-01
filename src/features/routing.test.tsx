// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('routing', () => {
  it('the gear (Settings) opens the new Settings screen; the old settings stay reachable', async () => {
    window.location.hash = '#/import'
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(window.location.hash).toBe('#/v2/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Add card' })).toBeTruthy()

    await user.click(screen.getByRole('link', { name: 'Old app settings' }))
    expect(window.location.hash).toBe('#/settings')
  })

  it('Import opens the new Import screen; the old import stays reachable', async () => {
    window.location.hash = '#/'
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Import' }))
    expect(window.location.hash).toBe('#/v2/import')
    expect(await screen.findByRole('heading', { name: 'Import' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Old import screen' }))
    expect(window.location.hash).toBe('#/import')
  })
})
