// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { statementInsights } from '../../domain/insights/insights'
import { freshNewDb } from '../../../test/data/oldDb'
import { OCT, SEP, seedCards, tx, UNB } from '../../../test/transactions/ledger'
import { renderScreen, settle } from '../../test-utils/ui'
import { InsightsPage } from './InsightsPage'

// Synthetic data only: the small "BCA Keluarga" ledger (test/transactions/ledger.ts).

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(async () => {
  await settle() // the last action's reads finish inside the test, on every run
  cleanup()
  vi.unstubAllGlobals()
})

async function seeded() {
  const db = await seedCards(freshNewDb())
  await db.transactions.bulkPut([
    tx('t1', OCT.id, '2026-10-03', 'IKEA ALAM SUTERA', 300_000, 'andi'),
    tx('t2', OCT.id, '2026-10-04', 'GRAB* A-1', 9_000, 'andi'),
    tx('t3', OCT.id, '2026-10-05', 'GRAB* A-2', 21_000, 'andi'),
    tx('t4', OCT.id, '2026-10-06', 'GRAMEDIA MATRAMAN', 120_000, 'sari'),
    tx('t5', OCT.id, '2026-10-07', 'REFUND GRAMEDIA MATRAMAN', -20_000, 'sari'),
    tx('t6', OCT.id, '2026-10-12', 'BIAYA ADM KARTU', 15_000, null, { kind: 'fee' }),
    tx('t7', SEP.id, '2026-09-03', 'NETFLIX.COM', 186_000, 'sari'),
    tx('t8', UNB, '2026-10-20', 'HALODOC', 85_000, 'andi'),
  ])
  return db
}

const box = (name: string) => screen.getByRole('generic', { name }) as HTMLElement
const rowsOf = (name: string) =>
  Array.from(box(name).querySelectorAll('.ins-row')).map((r) => [r.querySelector('.row span')!.textContent, r.querySelector('.row b')!.textContent, (r.querySelector('.bar i') as HTMLElement).style.width])

describe('Insights preview', () => {
  it('N-02 N-03 the latest statement: spent, per person, per kind and top merchants, from the domain; marked as a preview', async () => {
    const db = await seeded()
    renderScreen(<InsightsPage />, { db })
    expect(await screen.findByText('Spent on the Oct 2026 statement')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy()
    expect(screen.getByText('Preview · built in phase 2')).toBeTruthy()
    expect(screen.getByText('Phase 2 preview').className).toBe('pill warn')
    expect(screen.getByRole('button', { name: 'Statement: Oct 2026 statement' })).toBeTruthy()

    const domain = statementInsights(await import('../../data/repo').then((m) => m.loadLedger(db, 'bca')), OCT.id)
    expect(domain.spent).toBe(445_000)
    expect(within(box('Spent')).getByText('Rp 445.000')).toBeTruthy()
    expect(within(box('Spent')).getByText('6 rows')).toBeTruthy()
    expect(within(box('Spent')).getByText('Charges 465.000 minus refunds 20.000.')).toBeTruthy()

    expect(rowsOf('Spent by person')).toEqual([
      ['Andi', '330.000', '100%'],
      ['Sari', '100.000', '30%'],
      ['No owner', '15.000', '5%'],
    ])
    expect(rowsOf('By kind')).toEqual([
      ['Purchases', '450.000', '100%'],
      ['Fees and interest', '15.000', '3%'],
      ['Refunds', '20.000', '4%'],
    ])
    expect(rowsOf('Top merchants')).toEqual([
      ['Ikea Alam Sutera', '300.000', '100%'],
      ['Gramedia Matraman', '100.000', '33%'],
      ['Grab', '30.000', '10%'],
    ])
    expect(within(box('Top merchants')).getAllByText('2 rows')).toHaveLength(2) // Gramedia (with its refund) and Grab
    // Last statements: Sep, then Oct (shown).
    expect(rowsOf('Last statements')).toEqual([
      ['Sep 2026', '186.000', '42%'],
      ['Oct 2026 (shown)', '445.000', '100%'],
    ])
  })

  it('N-04 picking another statement (custom picker) updates every box; Unbilled has no "Last statements" end of its own', async () => {
    const db = await seeded()
    const { user } = renderScreen(<InsightsPage />, { db })
    await screen.findByText('Spent on the Oct 2026 statement')
    await user.click(screen.getByRole('button', { name: 'Statement: Oct 2026 statement' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Statement' })).getByRole('option', { name: /Sep 2026 statement/ }))
    expect(await screen.findByText('Spent on the Sep 2026 statement')).toBeTruthy()
    expect(rowsOf('Spent by person')).toEqual([['Sari', '186.000', '100%']])
    expect(screen.queryByText(/minus refunds/)).toBeNull()
    expect(screen.queryByRole('generic', { name: 'Last statements' })).toBeNull() // one statement only up to Sep

    await user.click(screen.getByRole('button', { name: 'Statement: Sep 2026 statement' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Statement' })).getByRole('option', { name: /Unbilled/ }))
    expect(await screen.findByText('Spent in Unbilled')).toBeTruthy()
    expect(rowsOf('Spent by person')).toEqual([['Andi', '85.000', '100%']])
    expect(rowsOf('Last statements').map((r) => r[0])).toEqual(['Sep 2026', 'Oct 2026'])
    expect(document.querySelectorAll('select')).toHaveLength(0) // U-01
  })

  it('U-03 the card bar on Insights opens the card picker; another card shows its own data', async () => {
    const db = await seeded()
    const { user } = renderScreen(<InsightsPage />, { db })
    await screen.findByText('Spent on the Oct 2026 statement')
    await user.click(screen.getByRole('button', { name: /^Card: BCA Keluarga/ }))
    await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: /Mandiri Pribadi/ }))
    expect(await screen.findByText('Nothing was spent on Unbilled.')).toBeTruthy()
    expect(screen.queryByRole('generic', { name: 'Spent by person' })).toBeNull()
  })

  it('no card, or a card without statements', async () => {
    renderScreen(<InsightsPage />)
    expect(await screen.findByText('Add a card in Settings first.')).toBeTruthy()
    cleanup()
    const db = freshNewDb()
    await db.cards.put({ id: 'x', name: 'Empty', bank: 'BNI', defaultOwnerId: null } as never)
    renderScreen(<InsightsPage />, { db })
    expect(await screen.findByText('No statements on this card yet. Import one first.')).toBeTruthy()
  })
})
