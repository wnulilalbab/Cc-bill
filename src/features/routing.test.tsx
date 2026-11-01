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

  it('Transactions opens the new Transactions screen; the old one stays reachable', async () => {
    window.location.hash = '#/'
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(window.location.hash).toBe('#/v2/transactions')
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Old transactions screen' }))
    expect(window.location.hash).toBe('#/transactions')
  })

  it('Bill is the home screen: "/" opens it, the Bill tab leads back to it, and the old dashboard stays reachable', async () => {
    window.location.hash = '#/'
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Bill' })).toBeTruthy()
    expect(window.location.hash).toBe('#/v2/bill')
    await user.click(screen.getByRole('link', { name: 'Old dashboard' }))
    expect(window.location.hash).toBe('#/dashboard')
    await user.click(screen.getByRole('link', { name: 'Bill' }))
    expect(window.location.hash).toBe('#/v2/bill')
    expect(await screen.findByRole('heading', { name: 'Bill' })).toBeTruthy()
  })

  it('Payments opens the new Payments screen; the old one stays reachable', async () => {
    window.location.hash = '#/'
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Payments' }))
    expect(window.location.hash).toBe('#/v2/payments')
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Old payments screen' }))
    expect(window.location.hash).toBe('#/payments')
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

  it('#/v2/share opens the Share screen (until the Bill screen carries the Share buttons)', async () => {
    window.location.hash = '#/v2/share'
    const { default: App } = await import('../App')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Share' })).toBeTruthy()
  })
})
