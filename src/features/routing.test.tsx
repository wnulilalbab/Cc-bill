// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromLegacy, PATHS } from './shell/paths'
import { STAGING_TEXT } from './shell/StagingBanner'

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openApp(hash: string) {
  window.location.hash = hash
  const { default: App } = await import('../App')
  const user = userEvent.setup()
  render(<App />)
  return user
}

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const tab = (name: string) => within(nav()).getByRole('link', { name })
/** The gear in the top bar. */
const topBar = () => document.querySelector<HTMLElement>('header.top')!
const gear = () => within(topBar()).queryByRole('link', { name: 'Settings' })
const current = () =>
  within(nav())
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent)

describe('app shell', () => {
  it('"/" opens Bill; the bottom nav has Bill, Transactions, Import and Payments (no Settings); the active tab is marked', async () => {
    await openApp('#/')
    expect(await screen.findByRole('heading', { name: 'Bill' })).toBeTruthy()
    expect(window.location.hash).toBe('#/bill')
    expect(within(nav()).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Bill', '#/bill'],
      ['Transactions', '#/transactions'],
      ['Import', '#/import'],
      ['Payments', '#/payments'],
    ])
    // Icons as in the prototype; Import is the round "+" button.
    for (const a of within(nav()).getAllByRole('link')) expect(a.querySelector('.ic svg')).toBeTruthy()
    expect(tab('Import').className).toBe('plus')
    expect(current()).toEqual(['Bill'])
    // The whole app is one themed shell.
    expect(nav().closest('.ccb')).toBeTruthy()
  })

  it.each([
    ['Transactions', '#/transactions'],
    ['Payments', '#/payments'],
    ['Import', '#/import'],
    ['Bill', '#/bill'],
  ])('the %s tab opens its screen with the top bar and the gear', async (name, hash) => {
    const user = await openApp('#/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    await user.click(tab(name))
    expect(window.location.hash).toBe(hash)
    expect(await screen.findByRole('heading', { name, level: 1 })).toBeTruthy()
    expect(current()).toEqual([name])
    expect(gear()!.getAttribute('href')).toBe('#/settings')
    expect(gear()!.querySelector('svg')).toBeTruthy()
  })

  it('the gear opens Settings, which has Back and no gear; Back goes home when opened directly', async () => {
    const user = await openApp('#/import')
    await screen.findByRole('heading', { name: 'Import' })
    await user.click(gear()!)
    expect(window.location.hash).toBe('#/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Add card' })).toBeTruthy()
    expect(gear()).toBeNull()
    expect(current()).toEqual([])
    // Back returns to where the gear was tapped.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    cleanup()

    const again = await openApp('#/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    window.history.replaceState(null, '') // opened from a link: nothing to go back to in the app
    await again.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.hash).toBe('#/bill'))
  })

  it('no screen links to the retired old screens', async () => {
    for (const hash of ['#/bill', '#/transactions', '#/payments', '#/import', '#/settings']) {
      await openApp(hash)
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryAllByRole('link', { name: /^Old / })).toEqual([])
      cleanup()
    }
  })
})

describe('routes', () => {
  it.each([
    ['#/v2/bill', '#/bill', 'Bill'],
    ['#/v2/transactions?statement=s1&status=check', '#/transactions?statement=s1&status=check', 'Transactions'],
    ['#/v2/payments', '#/payments', 'Payments'],
    ['#/v2/import', '#/import', 'Import'],
    ['#/v2/settings', '#/settings', 'Settings'],
    ['#/v2/rules', '#/rules', 'Tagging rules'],
    ['#/v2/share', '#/share', 'Share'],
    ['#/v2', '#/bill', 'Bill'],
  ])('the Phase-1 path %s redirects to %s', async (from, to, heading) => {
    await openApp(from)
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeTruthy()
    expect(window.location.hash).toBe(to)
  })

  it.each(['#/dashboard', '#/installments', '#/nowhere'])('the retired legacy screen %s redirects to Bill', async (from) => {
    await openApp(from)
    expect(await screen.findByRole('heading', { name: 'Bill' })).toBeTruthy()
    expect(window.location.hash).toBe('#/bill')
  })

  it('fromLegacy maps /v2 paths (with their query) onto the short paths and leaves others alone', () => {
    expect(fromLegacy('/v2/bill/person/abc', '?s=oct')).toBe('/bill/person/abc?s=oct')
    expect(fromLegacy('/v2/payments/new')).toBe('/payments/new')
    expect(fromLegacy('/v2')).toBe(PATHS.bill)
    expect(fromLegacy('/v2x/bill')).toBe('/v2x/bill')
    expect(fromLegacy('/transactions')).toBe('/transactions')
  })
})

describe('staging banner', () => {
  it('staging: a slim fixed banner reads "Staging — test data" with the version', async () => {
    vi.stubGlobal('__APP_ENV__', 'staging')
    await openApp('#/bill')
    await screen.findByRole('heading', { name: 'Bill' })
    const banner = screen.getByRole('note', { name: 'Staging' })
    expect(banner.textContent).toBe(`${STAGING_TEXT} · v0.0.0-test`)
    expect(STAGING_TEXT).toBe('Staging — test data')
    expect(banner.className).toBe('stage')
    expect(banner.closest('.app')!.classList.contains('staging')).toBe(true)
  })

  it('production: no banner', async () => {
    await openApp('#/bill')
    await screen.findByRole('heading', { name: 'Bill' })
    expect(screen.queryByRole('note', { name: 'Staging' })).toBeNull()
    expect(screen.queryByText(/Staging/)).toBeNull()
    expect(document.querySelector('.app')!.classList.contains('staging')).toBe(false)
  })
})

describe('the old database', () => {
  it.each(['production', 'staging'] as const)('%s: starting the app never opens or creates the old database', async (env) => {
    vi.stubGlobal('__APP_ENV__', env)
    const user = await openApp('#/')
    await screen.findByRole('heading', { name: 'Bill' })
    // Visit every tab, as a user would.
    for (const name of ['Transactions', 'Import', 'Payments', 'Bill']) {
      await user.click(tab(name))
      await screen.findByRole('heading', { name, level: 1 })
    }
    expect(await Dexie.exists('CCBillDB')).toBe(false)
    expect(await Dexie.exists('CCBillDB-staging')).toBe(false)
    // The new database is the one the app uses.
    expect((await Dexie.getDatabaseNames()).some((n) => n.startsWith('ccbill-v2'))).toBe(true)
  })
})
