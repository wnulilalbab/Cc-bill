// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveCard, sortOwners, type OwnerRecord } from '../../data/cards'
import type { NewDb } from '../../data/db'
import { renderScreen, token } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { paletteOf } from '../look/palettes'
import { PREF_KEYS } from '../look/prefs'
import { SettingsPage } from './SettingsPage'

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sheet = () => screen.getByRole('dialog')
const owners = async (db: NewDb, cardId: string) => sortOwners((await db.owners.where('cardId').equals(cardId).toArray()) as OwnerRecord[])

async function seedCard(db: NewDb, name = 'Synthetic Card', palette = 'blue') {
  return saveCard(db, {
    name,
    bank: 'BCA',
    last4: '1111',
    statementDay: '12',
    palette,
    owners: [
      { name: 'Andi', color: '#2563eb' },
      { name: 'Sari', color: '#db2777' },
    ],
    defaultIndex: 0,
  })
}

describe('Settings → Cards', () => {
  it('C-01 adds a card with its own owners and Unbilled; it becomes the selected card', async () => {
    const db = freshNewDb()
    await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await screen.findByText('Synthetic Card')
    await waitFor(() => expect(token('--acc')).toBe(paletteOf('blue').acc))

    await user.click(screen.getByRole('button', { name: '+ Add card' }))
    expect(within(sheet()).getByRole('heading', { name: 'Add card' })).toBeTruthy()
    await user.type(screen.getByLabelText('Name'), 'Synthetic Mandiri')
    await user.click(screen.getByRole('button', { name: 'Bank: BNI' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Bank' })).getByRole('option', { name: 'Mandiri' }))
    await user.type(screen.getByLabelText('Last 4 digits'), '42x21')
    await user.type(screen.getByLabelText('Statement day'), '11')
    await user.click(screen.getByRole('button', { name: 'Violet' }))
    const nameInputs = screen.getAllByLabelText('Owner name')
    await user.clear(nameInputs[0])
    await user.type(nameInputs[0], 'Bima')
    await user.click(screen.getByRole('button', { name: '+ Add owner' }))
    await user.click(screen.getByRole('button', { name: 'Save card' }))

    await screen.findByText('Card saved')
    const cards = await db.cards.toArray()
    const created = cards.find((c) => c.name === 'Synthetic Mandiri')!
    expect(created).toMatchObject({ bank: 'Mandiri', last4: '4221', statementDay: 11, palette: 'violet' })
    expect((await owners(db, created.id)).map((o) => o.name)).toEqual(['Bima', 'New owner'])
    expect(await db.statements.get(`${created.id}-unbilled`)).toBeTruthy()
    await waitFor(() => expect(token('--acc')).toBe(paletteOf('violet').acc))
    expect(localStorage.getItem(PREF_KEYS.selectedCard)).toBe(created.id)
    expect(screen.getByRole('button', { name: 'Edit Synthetic Mandiri' }).getAttribute('aria-current')).toBe('true')
  })

  it('C-02 changing the palette updates the accent, background and hero tokens app-wide', async () => {
    const db = freshNewDb()
    await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Orange' }))
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    const orange = paletteOf('orange')
    await waitFor(() => expect(token('--acc')).toBe(orange.acc))
    expect(token('--pbg')).toBe(orange.bg)
    expect(token('--hero')).toBe(orange.soft)
    expect(token('--tile')).toBe(orange.deep)
    expect(screen.getByText('Orange')).toBeTruthy() // palette pill on the card row
  })

  it('C-03 removes an owner without history', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    const removeButtons = within(sheet()).getAllByRole('button', { name: 'Remove' })
    expect(removeButtons).toHaveLength(2)
    await user.click(removeButtons[1])
    expect(screen.getAllByLabelText('Owner name')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByText('Card saved')
    expect((await owners(db, id)).map((o) => o.name)).toEqual(['Andi'])
  })

  it('C-04 an owner with history offers only Archive; archived is hidden from the default picker and can be restored', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const [andi, sari] = await owners(db, id)
    await db.transactions.put({ id: 't1', cardId: id, statementId: `${id}-unbilled`, date: '2026-10-01', description: 'SHOP', amount: 1000, kind: 'purchase', ownerId: sari.id })
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    const rows = screen.getAllByLabelText('Owner name').map((i) => i.parentElement!)
    expect(within(rows[0]).getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(within(rows[1]).queryByRole('button', { name: 'Remove' })).toBeNull()
    await user.click(within(rows[1]).getByRole('button', { name: 'Archive' }))
    expect(within(rows[1]).getByRole('button', { name: 'Restore' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Default owner: Andi' }))
    const picker = screen.getByRole('listbox', { name: 'Default owner' })
    expect(within(picker).queryByRole('option', { name: 'Sari' })).toBeNull()
    await user.click(within(picker).getByRole('option', { name: 'Andi' }))

    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByText('Card saved')
    expect((await db.owners.get(sari.id))!.archived).toBe(true)
    expect(await db.owners.get(andi.id)).toBeTruthy()

    // Archiving the default owner resets the default to None; Restore brings the owner back.
    await user.click(screen.getByRole('button', { name: 'Edit Synthetic Card' }))
    await user.click(within(screen.getAllByLabelText('Owner name')[1].parentElement!).getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByText('Card saved')
    await waitFor(async () => expect((await db.owners.get(sari.id))!.archived).toBeUndefined())
  })

  it('C-05 choosing default owner None stores no default', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    expect(await screen.findByText(/default owner: Andi/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit Synthetic Card' }))
    await user.click(screen.getByRole('button', { name: 'Default owner: Andi' }))
    const none = within(screen.getByRole('listbox', { name: 'Default owner' })).getByRole('option', { name: /None/ })
    expect(none.textContent).toContain('marked "check"')
    await user.click(none)
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByText(/default owner: none/)
    expect((await db.cards.get(id))!.defaultOwnerId).toBeNull()
  })

  it('removing the default owner sets the default to None', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    await user.click(within(sheet()).getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.getByRole('button', { name: 'Default owner: None' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByText('Card saved')
    expect((await db.cards.get(id))!.defaultOwnerId).toBeNull()
  })

  it('shows validation problems and keeps the sheet open', async () => {
    const { user, db } = renderScreen(<SettingsPage />)
    await screen.findByText(/No cards yet/)
    await user.click(screen.getByRole('button', { name: '+ Add card' }))
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    expect(screen.getByRole('alert').textContent).toBe('Give the card a name.')
    expect(await db.cards.count()).toBe(0)
    await user.type(screen.getByLabelText('Name'), 'X')
    await user.click(screen.getByRole('button', { name: 'Change colour of Me' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await db.cards.count()).toBe(0)
  })

  it('shows a save error from the database', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    // The card's owner gains history after the sheet opened: removing it is refused on save.
    const [andi] = await owners(db, id)
    await db.transactions.put({ id: 't1', cardId: id, statementId: `${id}-unbilled`, date: '2026-10-01', description: 'SHOP', amount: 1000, kind: 'purchase', ownerId: andi.id })
    await user.click(within(sheet()).getAllByRole('button', { name: 'Remove' })[0])
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Andi has history. Archive them instead.')
  })

  it('deletes an unused card after a confirm step; a card with history cannot be deleted', async () => {
    const db = freshNewDb()
    const unused = await seedCard(db, 'Unused Card')
    const used = await seedCard(db, 'Used Card')
    const [o] = await owners(db, used)
    await db.transactions.put({ id: 't1', cardId: used, statementId: `${used}-unbilled`, date: '2026-10-01', description: 'SHOP', amount: 1000, kind: 'purchase', ownerId: o.id })
    const { user } = renderScreen(<SettingsPage />, { db })

    await user.click(await screen.findByRole('button', { name: 'Edit Used Card' }))
    expect(screen.queryByRole('button', { name: 'Delete card' })).toBeNull()
    expect(screen.getByText(/can't be deleted/)).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit Unused Card' }))
    await user.click(screen.getByRole('button', { name: 'Delete card' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    await user.click(screen.getByRole('button', { name: 'Delete card' }))
    await user.click(within(screen.getByText(/Its owners and its empty Unbilled/).closest('.status') as HTMLElement).getByRole('button', { name: 'Delete card' }))
    await screen.findByText('Card deleted')
    expect(await db.cards.get(unused)).toBeUndefined()
    await waitFor(() => expect(screen.queryByText('Unused Card')).toBeNull())
  })

  it('shows a delete error when the card gained history meanwhile', async () => {
    const db = freshNewDb()
    const id = await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    await db.payments.put({ id: 'p1', cardId: id, source: 'manual', date: '2026-10-01', amount: 1000, allocations: [] })
    await user.click(screen.getByRole('button', { name: 'Delete card' }))
    await user.click(within(screen.getByText(/Its owners/).closest('.status') as HTMLElement).getByRole('button', { name: 'Delete card' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be deleted/)
  })

  it('Escape closes only the topmost sheet (picker over card sheet)', async () => {
    const db = freshNewDb()
    await seedCard(db)
    const { user } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    await user.click(screen.getByRole('button', { name: 'Bank: BCA' }))
    expect(screen.getByRole('listbox', { name: 'Bank' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Bank: BCA' }))
    await user.click(screen.getByTestId('picker-overlay'))
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(screen.getByTestId('sheet-overlay'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Settings → Look', () => {
  it('C-06 Clean / Soft / Bold change the tokens and are remembered; the palette still applies', async () => {
    const db = freshNewDb()
    await seedCard(db, 'Synthetic Card', 'rose')
    const rose = paletteOf('rose')
    const { user, unmount } = renderScreen(<SettingsPage />, { db })
    await waitFor(() => expect(token('--hero')).toBe(rose.soft))
    expect(screen.getByRole('button', { name: 'Clean' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Soft' }))
    expect(token('--hero')).toBe('#ffffff')
    expect(token('--hero-line')).toBe(rose.soft)
    expect(document.documentElement.dataset.look).toBe('soft')

    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(token('--hero')).toBe(rose.acc)
    expect(token('--tile')).toBe('#0b0b0c')
    expect(token('--acc')).toBe(rose.acc)
    expect(localStorage.getItem(PREF_KEYS.look)).toBe('bold')

    unmount()
    renderScreen(<SettingsPage />, { db })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('U-01 the settings screen and its sheets use no native <select>', async () => {
    const db = freshNewDb()
    await seedCard(db)
    const { user, container } = renderScreen(<SettingsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Edit Synthetic Card' }))
    await user.click(screen.getByRole('button', { name: 'Bank: BCA' }))
    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })
})
