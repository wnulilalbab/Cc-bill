// @vitest-environment jsdom
// The share sheet on the Bill screen (hero, person rows) and on person detail. Synthetic household (fictional).
import 'fake-indexeddb/auto'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareMessage } from '../../domain/share/message'
import { renderRoutes } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { BCA_OWNERS, householdLedger, seedHousehold } from '../../../test/payments/household'
import { BillPage, personPath } from '../bill/BillPage'
import { PersonPage } from '../bill/PersonPage'
import { localIsoDate } from '../data/today'

const ROUTES = { '/bill': <BillPage />, '/bill/person/:ownerId': <PersonPage /> }
const NOV = 'bca-2026-11'
const ctx = () => ({ ledger: householdLedger(), card: { name: 'BCA Keluarga' }, owners: BCA_OWNERS.map((name) => ({ id: name, name })), statementId: NOV, today: localIsoDate() })
const preview = () => screen.getByLabelText('Message preview').textContent

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open(at = '/bill') {
  const db = await seedHousehold(freshNewDb())
  const r = renderRoutes(ROUTES, at, { db })
  return r
}

describe('Bill screen share', () => {
  it('the hero Share button shares everyone; Share all does too', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: "Share everyone's bill" }))
    expect(screen.getByRole('button', { name: 'Share with: Everyone' })).toBeTruthy()
    expect(preview()).toBe(shareMessage(ctx(), 'all').text)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Share preview' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    expect(screen.getByRole('button', { name: 'Share with: Everyone' })).toBeTruthy()
  })

  it('each person row has a Share action for that person', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: "Share Medis's bill" }))
    expect(screen.getByRole('button', { name: 'Share with: Medis' })).toBeTruthy()
    expect(preview()).toBe(shareMessage(ctx(), { ownerId: 'Medis' }).text)
  })

  it('person detail shares that person, from the header icon and the bottom button', async () => {
    const { user } = await open(personPath('Bima', NOV))
    await user.click(await screen.findByRole('button', { name: 'Share' }))
    const sheet = screen.getByRole('dialog', { name: 'Share preview' })
    expect(within(sheet).getByRole('button', { name: 'Share with: Bima' })).toBeTruthy()
    expect(preview()).toBe(shareMessage(ctx(), { ownerId: 'Bima' }).text)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: "Share Bima's bill" }))
    expect(screen.getByRole('button', { name: 'Share with: Bima' })).toBeTruthy()
  })
})
