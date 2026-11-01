// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../domain/types'
import type { NewDb } from '../../data/db'
import { listDismissals, listRules, saveRule } from '../../data/rules'
import { renderScreen } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { PREF_KEYS } from '../look/prefs'
import { lsSet } from '../../lib/storage'
import { SettingsPage } from '../settings/SettingsPage'
import { AnalyzeSheet } from './AnalyzeSheet'
import { RulesPage } from './RulesPage'
import { TagSheet } from './TagSheet'

// Synthetic household: card "BCA Keluarga" (Andi, Sari, Bima archived), card "Mandiri Pribadi" (Andi).
const KEY = 'sk-ant-test-0000000000000000'

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function seed(db: NewDb = freshNewDb()) {
  await db.cards.bulkPut([
    { id: 'bca', name: 'BCA Keluarga', bank: 'BCA', defaultOwnerId: 'bca-andi' },
    { id: 'mdr', name: 'Mandiri Pribadi', bank: 'Mandiri', defaultOwnerId: 'mdr-andi' },
  ])
  await db.owners.bulkPut([
    { id: 'bca-andi', cardId: 'bca', name: 'Andi' },
    { id: 'bca-sari', cardId: 'bca', name: 'Sari' },
    { id: 'bca-bima', cardId: 'bca', name: 'Bima', archived: true },
    { id: 'mdr-andi', cardId: 'mdr', name: 'Andi' },
  ])
  return db
}
const tx = (id: string, description: string, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id, cardId: 'bca', statementId: 'bca-unbilled', date: '2026-10-01', description, amount: 9000, kind: 'purchase', ownerId, ...extra,
})
const sheet = () => screen.getByRole('dialog')
const ownersOf = async (db: NewDb, cardId: string) => db.owners.where('cardId').equals(cardId).toArray()

describe('tag sheet', () => {
  it('T-06 owner change → "Always tag" saves a rule for that card only, then previews and applies it to matching rows', async () => {
    const db = await seed()
    await db.transactions.bulkPut([
      tx('t1', 'KIDZANIA JAKARTA', 'bca-andi', { check: true, tagSource: 'default' }),
      tx('t2', 'KIDZANIA JAKARTA', null),
      tx('t3', 'KIDZANIA JAKARTA', 'bca-andi', { tagSource: 'manual' }),
      tx('t4', 'KIDZANIA JAKARTA', 'bca-andi', { check: true }),
      tx('m1', 'KIDZANIA JAKARTA', null, { cardId: 'mdr' }),
    ])
    const t1 = (await db.transactions.get('t1'))!
    const onClose = vi.fn()
    const { user } = renderScreen(<TagSheet tx={t1} cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={onClose} />, { db })
    expect(within(sheet()).getByText('● Check')).toBeTruthy()
    expect(within(sheet()).queryByRole('button', { name: 'Bima' })).toBeNull() // archived
    await user.click(within(sheet()).getByRole('button', { name: 'Sari' }))
    await user.click(screen.getByLabelText('Always tag "KIDZANIA" as Sari on BCA Keluarga'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const step = await screen.findByLabelText('Apply rule')
    expect(within(step).getByText('2 rows that need a check or have no owner will change.')).toBeTruthy()
    expect(within(step).getByText(/Also change 1 row that already have another owner/)).toBeTruthy()
    expect(within(step).getByText(/1 set by you/)).toBeTruthy()
    await user.click(within(step).getByRole('button', { name: 'Apply to 2 rows' }))

    await screen.findByText('Rule saved and applied to 2 more rows')
    expect(onClose).toHaveBeenCalled()
    expect(await db.transactions.get('t1')).toMatchObject({ ownerId: 'bca-sari', tagSource: 'manual' })
    expect(await db.transactions.get('t2')).toMatchObject({ ownerId: 'bca-sari', tagSource: 'rule' })
    expect((await db.transactions.get('t4'))?.check).toBeUndefined()
    expect(await db.transactions.get('t3')).toMatchObject({ ownerId: 'bca-andi' })
    expect((await db.transactions.get('m1'))?.ownerId).toBeNull()
    expect((await listRules(db, 'bca')).map((r) => [r.pattern, r.ownerId])).toEqual([['KIDZANIA', 'bca-sari']])
    expect(await listRules(db, 'mdr')).toEqual([])
  })

  it('T-06 opting in also changes rows that already have another owner', async () => {
    const db = await seed()
    await db.transactions.bulkPut([tx('t1', 'HALODOC JAKARTA', 'bca-andi'), tx('t2', 'HALODOC JAKARTA', 'bca-andi', { tagSource: 'auto' })])
    const { user } = renderScreen(<TagSheet tx={(await db.transactions.get('t1'))!} cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={() => {}} />, { db })
    await user.click(screen.getByRole('button', { name: 'Sari' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const step = await screen.findByLabelText('Apply rule')
    expect(within(step).getByText('No rows that need a check match this rule.')).toBeTruthy()
    expect((within(step).getByRole('button', { name: 'Apply to 0 rows' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(step).getByRole('checkbox'))
    await user.click(within(step).getByRole('button', { name: 'Apply to 1 row' }))
    await screen.findByText('Rule saved and applied to 1 more row')
    expect(await db.transactions.get('t2')).toMatchObject({ ownerId: 'bca-sari', tagSource: 'rule' })
  })

  it('no other rows match → rule saved, Done', async () => {
    const db = await seed()
    await db.transactions.put(tx('t1', 'RS PONDOK INDAH', 'bca-andi'))
    const onClose = vi.fn()
    const { user } = renderScreen(<TagSheet tx={(await db.transactions.get('t1'))!} cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={onClose} />, { db })
    await user.click(screen.getByRole('button', { name: 'Sari' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await screen.findByText('Rule saved')
    expect(onClose).toHaveBeenCalled()
  })

  it('T-07 marketplace owner change: no rule offered; Check cleared because the user looked', async () => {
    const db = await seed()
    await db.transactions.put(tx('t1', 'SHOPEE.CO.ID *AP1260721 JAKARTA BARATID', 'bca-andi', { check: true }))
    const onClose = vi.fn()
    const { user } = renderScreen(<TagSheet tx={(await db.transactions.get('t1'))!} cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={onClose} />, { db })
    expect(screen.getByText(/Marketplace: the statement doesn't say who ordered/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sari' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. Marketplace rows always ask for a check, so no rule is offered.')
    expect(await db.transactions.get('t1')).toMatchObject({ ownerId: 'bca-sari', tagSource: 'manual' })
    expect(await listRules(db, 'bca')).toEqual([])
  })

  it('saving without a rule; errors are shown', async () => {
    const db = await seed()
    await db.transactions.put(tx('t1', 'NETFLIX.COM', null))
    const t1 = (await db.transactions.get('t1'))!
    const onClose = vi.fn()
    const { user } = renderScreen(<TagSheet tx={t1} cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={onClose} />, { db })
    expect(screen.queryByRole('checkbox')).toBeNull() // no owner picked yet
    await user.click(screen.getByRole('button', { name: 'Andi' }))
    await db.transactions.delete('t1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('This transaction no longer exists.')
    await db.transactions.put(t1)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Settings → Tagging rules', () => {
  it('Settings → Cards links to the rules screen, and Back returns to Settings', async () => {
    const db = await seed()
    const { user } = renderScreen(
      <Routes>
        <Route path="/" element={<SettingsPage />} />
        <Route path="/v2/settings" element={<SettingsPage />} />
        <Route path="/v2/rules" element={<RulesPage />} />
      </Routes>,
      { db },
    )
    await user.click(await screen.findByRole('link', { name: 'Tagging rules' }))
    expect(await screen.findByRole('heading', { name: 'Tagging rules' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('is reachable from Settings; lists the selected card\'s rules; switching card shows that card\'s rules (T-09)', async () => {
    const db = await seed()
    await saveRule(db, { cardId: 'bca', match: 'startsWith', pattern: 'GRAB*', ownerId: 'bca-andi' })
    await saveRule(db, { cardId: 'mdr', match: 'contains', pattern: 'OPENAI', ownerId: 'mdr-andi' })
    const { user } = renderScreen(<RulesPage />, { db })
    await screen.findByText('Tagging rules · BCA Keluarga')
    expect(await screen.findByText(/Starts with GRAB\*/)).toBeTruthy()
    expect(screen.queryByText(/OPENAI/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Card: BCA Keluarga' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: 'Mandiri Pribadi' }))
    expect(await screen.findByText(/Contains OPENAI/)).toBeTruthy()
    expect(screen.queryByText(/GRAB/)).toBeNull()
  })

  it('adds a rule (validated), previews and applies it; edits and deletes rules', async () => {
    const db = await seed()
    lsSet(PREF_KEYS.selectedCard, 'bca')
    await db.transactions.bulkPut([tx('t1', 'GRAMEDIA MATRAMAN', null), tx('t2', 'GRAMEDIA MATRAMAN', 'bca-andi')])
    const { user } = renderScreen(<RulesPage />, { db })
    await screen.findByText('No rules yet.')
    await user.click(screen.getByRole('button', { name: '+ Add rule' }))
    await user.type(screen.getByLabelText('Text'), 'g')
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(screen.getByText('Type at least 2 letters of the merchant.')).toBeTruthy()
    await user.type(screen.getByLabelText('Text'), 'ramedia')
    await user.click(screen.getByRole('button', { name: 'Owner: Andi' }))
    expect(within(screen.getByRole('listbox', { name: 'Owner' })).queryByRole('option', { name: 'Bima' })).toBeNull()
    await user.click(within(screen.getByRole('listbox', { name: 'Owner' })).getByRole('option', { name: 'Sari' }))
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    const step = await screen.findByLabelText('Apply rule')
    await user.click(within(step).getByRole('button', { name: 'Apply to 1 row' }))
    await screen.findByText('Rule saved and applied to 1 row')
    expect(await screen.findByText(/Contains GRAMEDIA/)).toBeTruthy()
    expect(await db.transactions.get('t1')).toMatchObject({ ownerId: 'bca-sari', tagSource: 'rule' })

    await user.click(screen.getByRole('button', { name: 'Edit rule Contains GRAMEDIA' }))
    await user.click(screen.getByRole('button', { name: 'Match: Contains' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Match' })).getByRole('option', { name: 'Starts with' }))
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    await user.click(within(await screen.findByLabelText('Apply rule')).getByRole('button', { name: 'Not now' }))
    await screen.findByText('Rule saved')
    expect(await screen.findByText(/Starts with GRAMEDIA/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Edit rule Starts with GRAMEDIA' }))
    await user.click(screen.getByRole('button', { name: 'Delete rule' }))
    await screen.findByText('Rule deleted')
    await screen.findByText('No rules yet.')
  })

  it('shows rules for archived owners as such, and a save error from the database', async () => {
    const db = await seed()
    lsSet(PREF_KEYS.selectedCard, 'bca')
    await db.rules.put({ id: 'r1', cardId: 'bca', match: 'contains', pattern: 'KIDZANIA', ownerId: 'bca-bima', updatedAt: '2026-10-01T00:00:00.000Z' })
    const { user } = renderScreen(<RulesPage />, { db })
    expect(await screen.findByText('Bima (archived)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '+ Add rule' }))
    await user.type(screen.getByLabelText('Text'), 'NETFLIX')
    await db.owners.delete('bca-andi')
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('Pick who this merchant belongs to.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without a card: asks to add one first', async () => {
    renderScreen(<RulesPage />)
    expect(await screen.findByText('Add a card in Settings first. Rules belong to one card.')).toBeTruthy()
  })
})

describe('T-08 Analyze my labels', () => {
  const answer = (rules: unknown[]) =>
    new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ rules }) }] }), { status: 200 })

  async function seedHistory() {
    const db = await seed()
    lsSet(PREF_KEYS.selectedCard, 'bca')
    lsSet(PREF_KEYS.aiApiKey, KEY)
    await db.transactions.bulkPut([
      tx('g1', 'GRAB* A-1 JAKARTA PUSATID', 'bca-andi'),
      tx('g2', 'GRAB* A-2 JAKARTA PUSATID', 'bca-andi'),
      tx('g3', 'GRAB* A-3 JAKARTA PUSATID', null, { check: true }),
      tx('k1', 'GRAMEDIA MATRAMAN', 'bca-sari'),
      tx('k2', 'GRAMEDIA MATRAMAN', 'bca-sari'),
      tx('k3', 'GRAMEDIA MATRAMAN', 'bca-andi'),
    ])
    return db
  }

  it('suggestions with evidence; Accept adds the rule (and offers to apply it); Dismiss removes it and keeps the comment', async () => {
    const db = await seedHistory()
    const fetch = vi.fn(async () =>
      answer([
        { match: 'startsWith', pattern: 'GRAB*', owner: 'Andi', reason: 'All rides are Andi.' },
        { match: 'contains', pattern: 'GRAMEDIA', owner: 'Sari', reason: 'Books' },
      ]),
    )
    vi.stubGlobal('fetch', fetch)
    const { user } = renderScreen(<RulesPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Analyze my labels' }))
    const grab = await screen.findByLabelText('Suggestion Starts with GRAB*')
    expect(within(grab).getByText('2 of 2 past rows agree')).toBeTruthy()
    expect(within(grab).getByText('All rides are Andi.')).toBeTruthy()
    const books = screen.getByLabelText('Suggestion Contains GRAMEDIA')
    expect(within(books).getByText('2 of 3 past rows agree')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('"x-api-key":"sk-ant-test-0000000000000000","body"')

    await user.type(within(books).getByLabelText('Comment'), 'Books are shared')
    await user.click(within(books).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByLabelText('Suggestion Contains GRAMEDIA')).toBeNull())
    expect(await listDismissals(db, 'bca')).toMatchObject([{ pattern: 'GRAMEDIA', ownerId: 'bca-sari', comment: 'Books are shared' }])

    await user.click(within(grab).getByRole('button', { name: 'Accept' }))
    await screen.findByText('Rule added')
    const step = await screen.findByLabelText('Apply rule')
    await user.click(within(step).getByRole('button', { name: 'Apply to 1 row' }))
    await screen.findByText('Applied to 1 row')
    expect(await db.transactions.get('g3')).toMatchObject({ ownerId: 'bca-andi', tagSource: 'rule' })
    expect(await listRules(db, 'bca')).toMatchObject([{ match: 'startsWith', pattern: 'GRAB*', ownerId: 'bca-andi', origin: 'analyze' }])
    expect(screen.getByText('No more suggestions.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText(/Starts with GRAB\*/)).toBeTruthy()
  })

  it('Edit changes the rule before accepting; evidence follows the edit', async () => {
    const db = await seedHistory()
    vi.stubGlobal('fetch', vi.fn(async () => answer([{ match: 'contains', pattern: 'GRAMEDIA', owner: 'Sari', reason: '' }])))
    const { user } = renderScreen(<AnalyzeSheet cardId="bca" cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={() => {}} />, { db })
    const card = await screen.findByLabelText('Suggestion Contains GRAMEDIA')
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    await user.click(within(card).getByRole('button', { name: 'Owner: Sari' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Owner' })).getByRole('option', { name: 'Andi' }))
    await waitFor(() => expect(within(card).getByText('1 of 3 past rows agree')).toBeTruthy())
    await user.click(within(card).getByRole('button', { name: 'Match: Contains' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Match' })).getByRole('option', { name: 'Starts with' }))
    await user.clear(within(card).getByLabelText('Text'))
    await user.type(within(card).getByLabelText('Text'), 'GRAMEDIA M')
    await waitFor(() => expect(within(screen.getByLabelText('Suggestion Starts with GRAMEDIA M')).getByText('1 of 3 past rows agree')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await screen.findByLabelText('Apply rule')
    expect(await listRules(db, 'bca')).toMatchObject([{ match: 'startsWith', pattern: 'GRAMEDIA M', ownerId: 'bca-andi' }])
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.getByText('No more suggestions.')).toBeTruthy()
  })

  it('bad AI JSON → readable error, nothing saved; no key → asks for it', async () => {
    const db = await seedHistory()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"rules": [{"oops": 1}]}' }] }), { status: 200 })))
    renderScreen(<AnalyzeSheet cardId="bca" cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={() => {}} />, { db })
    expect(await screen.findByText('The AI answer was not in the expected format. Nothing was changed. Try again.')).toBeTruthy()
    expect(await listRules(db, 'bca')).toEqual([])
    cleanup()
    localStorage.removeItem(PREF_KEYS.aiApiKey)
    renderScreen(<AnalyzeSheet cardId="bca" cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={() => {}} />, { db })
    expect(await screen.findByText('Add your Anthropic API key in Settings → AI first.')).toBeTruthy()
  })

  it('accepting a rule for an owner archived meanwhile shows the problem', async () => {
    const db = await seedHistory()
    vi.stubGlobal('fetch', vi.fn(async () => answer([{ match: 'startsWith', pattern: 'GRAB*', owner: 'Andi', reason: '' }])))
    const { user } = renderScreen(<AnalyzeSheet cardId="bca" cardName="BCA Keluarga" owners={await ownersOf(db, 'bca')} onClose={() => {}} />, { db })
    await screen.findByLabelText('Suggestion Starts with GRAB*')
    await db.owners.put({ id: 'bca-andi', cardId: 'bca', name: 'Andi', archived: true })
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Andi is archived. Pick another owner.')).toBeTruthy()
  })
})
