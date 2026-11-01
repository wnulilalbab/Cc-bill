// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMoney, ownerDepositLeft, txStatus, unassignedOf } from '../../domain/amounts'
import { ownerBill } from '../../domain/bill'
import type { NewDb } from '../../data/db'
import { loadLedger } from '../../data/repo'
import { listRules } from '../../data/rules'
import { renderScreen } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { OCT, pay, seedCards, seedPaidRows, tx, UNB } from '../../../test/transactions/ledger'
import { TransactionsPage } from './TransactionsPage'
import { applyFilters, defaultStatementId, NO_FILTERS, parseAmount, rowViews, searchMatches, statementName } from './view'

// Synthetic household (fictional): card "BCA Keluarga" with Andi, Sari (and archived Bima); see test/transactions/ledger.ts.
const PRINTED_OCT = { prevBalance: 0, credits: 164_631, purchases: 740_201, feesInterest: 15_000, newBalance: 590_570 }

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** seedPaidRows plus a Check row, a refund, an installment, two same-day Grab rows, a 9.000 row and a fee, all on Oct. */
async function seedScreen(db: NewDb = freshNewDb()) {
  await seedPaidRows(db)
  await db.statements.put({ ...OCT, printed: PRINTED_OCT })
  await db.transactions.update('t-books', { label: 'School books' })
  await db.transactions.bulkPut([
    tx('c1', OCT.id, '2026-10-06', 'SHOPEE.CO.ID *AP1 JAKARTA', 55_201, 'andi', { check: true, tagSource: 'ai' }),
    tx('r1', OCT.id, '2026-10-09', 'REFUND IKEA ALAM SUTERA', -44_631, 'andi', { kind: 'refund' }),
    tx('i1', OCT.id, '2026-10-10', 'CICILAN BCA KE 02 DARI 06, BLIBLI.COM', 200_000, 'sari', { kind: 'installment', installment: { n: 2, of: 6 }, tagSource: 'plan' }),
    tx('g1', OCT.id, '2026-10-08', 'GRAB* A-1PQ9', 25_000, 'andi'),
    tx('g2', OCT.id, '2026-10-08', 'GRAB* A-9ZZ1', 31_000, 'sari'),
    tx('k1', OCT.id, '2026-10-04', 'KCI COMMUTER', 9_000, 'sari'),
    tx('f1', OCT.id, '2026-10-12', 'BIAYA ADM KARTU', 15_000, 'andi', { kind: 'fee', tagSource: 'default' }),
  ])
  return db
}

const rowNames = () => Array.from(document.querySelectorAll('.screen .tx')).map((b) => b.getAttribute('aria-label'))
const row = (name: string) => screen.getByRole('button', { name })
const totals = () => within(screen.getByLabelText('Totals')).getAllByText(/\d/).map((e) => e.textContent)

async function choose(user: UserEvent, title: string, option: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${title}:`) }))
  const list = screen.getByRole('listbox', { name: title })
  // The option's label is the first text of its first span (a second line may follow).
  const match = within(list)
    .getAllByRole('option')
    .find((o) => o.firstElementChild?.firstChild?.textContent === option)
  if (!match) throw new Error(`no option "${option}" in ${title}`)
  await user.click(match)
}

async function open() {
  const db = await seedScreen()
  const r = renderScreen(<TransactionsPage />, { db })
  await screen.findByRole('button', { name: 'IKEA ALAM SUTERA 300.000' })
  return r
}

async function money(db: NewDb) {
  const ledger = await loadLedger(db, 'bca')
  const state = computeMoney(ledger)
  return {
    ledger,
    state,
    bill: (owner: string) => ownerBill(ledger, owner, OCT.id, '2026-10-25', state),
    unassigned: (id: string) => unassignedOf(ledger.payments.find((p) => p.id === id)!),
    status: (id: string) => txStatus(state, ledger.transactions.find((t) => t.id === id)!),
    deposit: (owner: string) => ownerDepositLeft(state, owner),
  }
}

describe('Transactions screen', () => {
  it('opens on the latest statement: rows grouped by day with owner, Check, kind, status, n/N; credits negative; totals; Draft', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'Statement: Oct 2026 statement' })).toBeTruthy()
    const days = screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'))
    expect(days).toEqual(['Mon 12 Oct 2026', 'Sat 10 Oct 2026', 'Fri 9 Oct 2026', 'Thu 8 Oct 2026', 'Tue 6 Oct 2026', 'Sun 4 Oct 2026', 'Sat 3 Oct 2026', 'Fri 2 Oct 2026'])
    expect(rowNames()).toHaveLength(9)

    const ikea = within(row('IKEA ALAM SUTERA 300.000'))
    expect(ikea.getByText('Andi')).toBeTruthy()
    expect(ikea.getByText('Paid')).toBeTruthy()
    expect(ikea.getByText('Rule')).toBeTruthy()
    expect(within(row('SHOPEE.CO.ID *AP1 JAKARTA 55.201')).getByText('● Check')).toBeTruthy()
    expect(within(row('SHOPEE.CO.ID *AP1 JAKARTA 55.201')).getByText('Unpaid')).toBeTruthy()
    const refund = within(row('REFUND IKEA ALAM SUTERA −44.631'))
    expect(refund.getByText('Refund')).toBeTruthy()
    expect(refund.getByText('−44.631')).toBeTruthy()
    expect(within(row('CICILAN BCA KE 02 DARI 06, BLIBLI.COM 200.000')).getByText('Installment 2/6')).toBeTruthy()
    expect(within(row('CICILAN BCA KE 02 DARI 06, BLIBLI.COM 200.000')).getByText('Plan')).toBeTruthy()
    expect(within(row('BIAYA ADM KARTU 15.000')).getByText('Fee')).toBeTruthy()
    expect(within(row('BIAYA ADM KARTU 15.000')).getByText('Card default')).toBeTruthy()
    // Label shown instead of the merchant, the raw line underneath.
    expect(within(row('School books 120.000')).getByText('GRAMEDIA MATRAMAN')).toBeTruthy()

    expect(totals()).toEqual(['710.570', '420.000', '290.570'])
    expect(screen.getByLabelText('Totals check').textContent).toContain('matches the statement ✓')
    const draft = screen.getByLabelText('Draft or Final')
    expect(within(draft).getByText('Draft · 1 thing to resolve')).toBeTruthy()
    expect(within(draft).getByRole('button', { name: '1 row needs a check' })).toBeTruthy()
  })

  it('X-07 same-day badge: "n of m same day" for the same merchant on the same day', async () => {
    await open()
    expect(within(row('GRAB* A-1PQ9 25.000')).getByText('1 of 2 same day')).toBeTruthy()
    expect(within(row('GRAB* A-9ZZ1 31.000')).getByText('2 of 2 same day')).toBeTruthy()
    expect(within(row('KCI COMMUTER 9.000')).queryByText(/same day/)).toBeNull()
  })

  it('X-01 search by description, amount (9000 or 9.000) and label; the input keeps focus', async () => {
    const { user } = await open()
    const search = screen.getByRole('searchbox', { name: 'Search transactions' })
    await user.type(search, 'grab')
    expect(rowNames()).toEqual(['GRAB* A-1PQ9 25.000', 'GRAB* A-9ZZ1 31.000'])
    expect(document.activeElement).toBe(search)
    expect(totals()).toEqual(['56.000', '0', '56.000'])
    await user.clear(search)
    await user.type(search, '9.000')
    expect(rowNames()).toEqual(['KCI COMMUTER 9.000'])
    await user.clear(search)
    await user.type(search, '9000')
    expect(rowNames()).toEqual(['KCI COMMUTER 9.000'])
    await user.clear(search)
    await user.type(search, 'school')
    expect(rowNames()).toEqual(['School books 120.000'])
    expect(document.activeElement).toBe(search)
    await user.clear(search)
    await user.type(search, 'nothing like this')
    expect(screen.getByText('No transactions match these filters.')).toBeTruthy()
  })

  it('X-08 status filters (Needs check / Unpaid or partly / Unpaid / Partly / Paid), owner and kind filters, totals per filter', async () => {
    const db = await seedScreen()
    await db.payments.put(pay('p-part', '2026-10-13', 10_000, { allocations: [{ txId: 'g2', amount: 10_000 }] }))
    const { user } = renderScreen(<TransactionsPage />, { db })
    await screen.findByRole('button', { name: 'IKEA ALAM SUTERA 300.000' })
    expect(within(row('GRAB* A-9ZZ1 31.000')).getByText('21.000 left')).toBeTruthy()

    await choose(user, 'Status', 'Needs check')
    expect(rowNames()).toEqual(['SHOPEE.CO.ID *AP1 JAKARTA 55.201'])
    await choose(user, 'Status', 'Unpaid or partly paid')
    expect(rowNames()).toEqual([
      'BIAYA ADM KARTU 15.000',
      'CICILAN BCA KE 02 DARI 06, BLIBLI.COM 200.000',
      'GRAB* A-1PQ9 25.000',
      'GRAB* A-9ZZ1 31.000',
      'SHOPEE.CO.ID *AP1 JAKARTA 55.201',
      'KCI COMMUTER 9.000',
    ])
    expect(totals()).toEqual(['335.201', '10.000', '325.201'])
    await choose(user, 'Status', 'Partly paid')
    expect(rowNames()).toEqual(['GRAB* A-9ZZ1 31.000'])
    await choose(user, 'Status', 'Unpaid')
    expect(rowNames()).not.toContain('GRAB* A-9ZZ1 31.000')
    expect(rowNames()).toHaveLength(5)
    await choose(user, 'Status', 'Paid')
    expect(rowNames()).toEqual(['IKEA ALAM SUTERA 300.000', 'School books 120.000'])
    expect(totals()).toEqual(['420.000', '420.000', '0'])

    await choose(user, 'Status', 'All status')
    await choose(user, 'Owner', 'Sari')
    expect(rowNames()).toEqual(['CICILAN BCA KE 02 DARI 06, BLIBLI.COM 200.000', 'GRAB* A-9ZZ1 31.000', 'KCI COMMUTER 9.000', 'School books 120.000'])
    expect(screen.getByText('4 rows of 9')).toBeTruthy()
    await choose(user, 'Owner', 'All owners')
    await choose(user, 'Kind', 'Refunds')
    expect(rowNames()).toEqual(['REFUND IKEA ALAM SUTERA −44.631'])
    expect(totals()).toEqual(['−44.631', '0', '−44.631'])
    await choose(user, 'Kind', 'Fees and interest')
    expect(rowNames()).toEqual(['BIAYA ADM KARTU 15.000'])
    await choose(user, 'Kind', 'Installments')
    expect(rowNames()).toEqual(['CICILAN BCA KE 02 DARI 06, BLIBLI.COM 200.000'])
  })

  it('statement picker includes Unbilled; the card switcher changes card; F-01 the Check link filters to Check rows', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: '1 row needs a check' }))
    expect(screen.getByRole('button', { name: 'Status: Needs check' })).toBeTruthy()
    await choose(user, 'Status', 'All status')

    await choose(user, 'Statement', 'Unbilled')
    expect(rowNames()).toEqual(['GRAB* A-7XK2 150.000'])
    expect(within(row('GRAB* A-7XK2 150.000')).getByText('Paid')).toBeTruthy() // from Andi's deposit
    expect(screen.queryByLabelText('Totals check')).toBeNull()
    await choose(user, 'Statement', 'Sep 2026 statement')
    expect(screen.getByText('No transactions match these filters.')).toBeTruthy()
    expect(within(screen.getByLabelText('Draft or Final')).getByText('Final ✓')).toBeTruthy()

    await choose(user, 'Card', 'Mandiri Pribadi')
    expect(await screen.findByRole('button', { name: 'Statement: Unbilled' })).toBeTruthy()
    expect(rowNames()).toEqual([])
  })

  it('F-01 / F-08 Draft lists every issue with a link to the row; Keep waiting resolves a row not on the statement', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.bulkPut([
      ...['a', 'b', 'c', 'd'].map((id) => tx(id, OCT.id, '2026-10-05', `TOKO ${id.toUpperCase()}`, 10_000, 'andi', { check: true })),
      tx('w', OCT.id, '2026-10-05', 'REFUND TOKO', 5_000, 'andi', { kind: 'refund' }),
      tx('u', UNB, '2026-10-01', 'PENDING TOKO', 7_000, 'andi'),
    ])
    await db.payments.bulkPut([pay('bank', '2026-10-06', 50_000, { source: 'statement', statementId: OCT.id })])
    const { user } = renderScreen(<TransactionsPage />, { db })
    const draft = await screen.findByLabelText('Draft or Final')
    expect(within(draft).getByText('Draft · 7 things to resolve')).toBeTruthy()
    expect(within(draft).getByRole('button', { name: '4 rows need a check' })).toBeTruthy()
    expect(within(draft).getByText(/Not fully assigned: 6 Oct 2026 · Bank payment · Rp 50.000 \(Rp 50.000 left\)/)).toBeTruthy()
    await user.click(within(draft).getByRole('button', { name: 'Sign looks wrong: REFUND TOKO 5.000' }))
    expect(screen.getByRole('dialog', { name: 'REFUND TOKO' })).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await user.click(within(draft).getByRole('button', { name: 'Not on this statement: PENDING TOKO 7.000' }))
    const sheet = screen.getByRole('dialog', { name: 'PENDING TOKO' })
    expect(within(sheet).getByText('Not on the Oct 2026 statement')).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Keep waiting' }))
    await screen.findByText('OK. It stays in Unbilled for the next statement.')
    await waitFor(() => expect(within(screen.getByLabelText('Draft or Final')).getByText('Draft · 6 things to resolve')).toBeTruthy())
    expect((await db.transactions.get('u'))?.keepWaiting).toBe(true)
  })

  it('F-09 Final ✓ when nothing is left; no card → asks to add one', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.put(tx('a', OCT.id, '2026-10-05', 'TOKO', 10_000, 'andi', { tagSource: 'manual' }))
    renderScreen(<TransactionsPage />, { db })
    expect(within(await screen.findByLabelText('Draft or Final')).getByText('Final ✓')).toBeTruthy()
    cleanup()
    renderScreen(<TransactionsPage />)
    expect(await screen.findByText('Add a card in Settings first.')).toBeTruthy()
  })
})

describe('row sheet', () => {
  it('X-05 owner change on a paid row → Keep payment: assignment kept; bills move with the charge', async () => {
    const { user, db } = await open()
    await user.click(row('IKEA ALAM SUTERA 300.000'))
    await user.click(within(screen.getByRole('dialog', { name: 'IKEA ALAM SUTERA' })).getByRole('button', { name: 'Sari' }))
    const tag = screen.getByRole('dialog', { name: 'IKEA ALAM SUTERA' })
    expect(within(tag).getByRole('button', { name: 'Sari' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(tag).getByRole('button', { name: 'Save' }))
    const ask = await screen.findByRole('dialog', { name: 'This charge already has a payment' })
    expect(within(ask).getByText("Rp 300.000 from Andi's payment covers it. You're moving it to Sari.")).toBeTruthy()
    expect(within(ask).getByText("Andi's money keeps paying this charge, now owned by Sari.")).toBeTruthy()
    expect(within(ask).getByText("The charge becomes unpaid for Sari. The payment goes back to Andi's deposit.")).toBeTruthy()
    await user.click(within(ask).getByRole('button', { name: 'Keep payment' }))
    await screen.findByText('Saved. The payment stays on it.')
    await waitFor(() => expect(within(row('IKEA ALAM SUTERA 300.000')).getByText('Sari')).toBeTruthy())
    expect(within(row('IKEA ALAM SUTERA 300.000')).getByText('Paid')).toBeTruthy()

    const m = await money(db)
    expect(m.status('t-ikea')).toBe('paid')
    expect(m.unassigned('p-andi')).toBe(200_000)
    expect(m.bill('sari')).toMatchObject({ charges: 660_000, alreadyPaid: 420_000, mustPay: 240_000 })
    expect(m.bill('andi')).toMatchObject({ charges: 50_570, alreadyPaid: 0, mustPay: 50_570, depositWaiting: 50_000 })
  })

  it('X-06 owner change on a paid row → Unassign: assignment removed; charge unpaid; payer’s deposit grows', async () => {
    const { user, db } = await open()
    const before = await money(db)
    expect(before.bill('sari')).toMatchObject({ charges: 360_000, alreadyPaid: 120_000, mustPay: 240_000 })
    expect(before.bill('andi')).toMatchObject({ charges: 350_570, alreadyPaid: 300_000, mustPay: 50_570 })
    expect(before.deposit('andi')).toBe(50_000)

    await user.click(row('IKEA ALAM SUTERA 300.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sari' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'This charge already has a payment' })).getByRole('button', { name: 'Unassign' }))
    await screen.findByText('Saved. The payment was unassigned.')
    await waitFor(() => expect(within(row('IKEA ALAM SUTERA 300.000')).getByText('Unpaid')).toBeTruthy())

    const m = await money(db)
    expect(m.status('t-ikea')).toBe('unpaid')
    expect(m.ledger.payments.find((p) => p.id === 'p-andi')!.allocations).toEqual([])
    expect(m.unassigned('p-andi')).toBe(500_000)
    expect(m.deposit('andi')).toBe(350_000)
    expect(m.bill('sari')).toMatchObject({ charges: 660_000, alreadyPaid: 120_000, mustPay: 540_000 })
    expect(m.bill('andi')).toMatchObject({ charges: 50_570, mustPay: 50_570, depositWaiting: 350_000 })
    expect(totals()).toEqual(['710.570', '120.000', '590.570'])
  })

  it('owner change without a payment; "Always tag…" saves a rule (T-06); Cancel goes back to the row sheet', async () => {
    const { user, db } = await open()
    await user.click(row('KCI COMMUTER 9.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Andi' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(within(screen.getByRole('dialog', { name: 'KCI COMMUTER' })).getByText('Line on the statement')).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Andi' }))
    await user.click(screen.getByLabelText('Always tag "KCI COMMUTER" as Andi on BCA Keluarga'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await user.click(within(await screen.findByLabelText('Apply rule')).getByRole('button', { name: 'Done' }))
    await screen.findByText('Rule saved')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await db.transactions.get('k1')).toMatchObject({ ownerId: 'andi', tagSource: 'manual' })
    expect((await listRules(db, 'bca')).map((r) => [r.pattern, r.ownerId])).toEqual([['KCI COMMUTER', 'andi']])
  })

  it('clear Check: owner kept, source You so history learns from it; mark reviewed on a rule row', async () => {
    const { user, db } = await open()
    await user.click(row('SHOPEE.CO.ID *AP1 JAKARTA 55.201'))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(/Marketplace: the statement doesn't say who ordered/)).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Clear Check: Andi is right' }))
    await screen.findByText('Check cleared. Andi confirmed.')
    expect(await db.transactions.get('c1')).toMatchObject({ ownerId: 'andi', tagSource: 'manual' })
    expect((await db.transactions.get('c1'))?.check).toBeUndefined()
    await waitFor(() => expect(within(screen.getByLabelText('Draft or Final')).getByText('Final ✓')).toBeTruthy())

    await user.click(row('GRAB* A-1PQ9 25.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reviewed' }))
    await screen.findByText('Andi confirmed.')
    expect((await db.transactions.get('g1'))?.tagSource).toBe('manual')
  })

  it('shows the payments covering a row: M-02 "after due", D-01 "From <owner>’s deposit", none yet', async () => {
    const db = await seedScreen()
    await db.payments.put(pay('p-late', '2026-11-02', 9_000, { allocations: [{ txId: 'k1', amount: 9_000 }], description: 'Transfer from Sari' }))
    const { user } = renderScreen(<TransactionsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'KCI COMMUTER 9.000' }))
    let box = within(screen.getByLabelText('Payments covering this'))
    expect(box.getByText(/2 Nov 2026 · Transfer from Sari/)).toBeTruthy()
    expect(box.getByText('after due')).toBeTruthy()
    expect(box.getByText('− 9.000')).toBeTruthy()
    expect(box.getByText('Paid')).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await user.click(row('IKEA ALAM SUTERA 300.000'))
    box = within(screen.getByLabelText('Payments covering this'))
    expect(box.getByText('15 Oct 2026 · Recorded by you')).toBeTruthy()
    expect(box.queryByText('after due')).toBeNull()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await user.click(row('GRAB* A-1PQ9 25.000'))
    expect(within(screen.getByLabelText('Payments covering this')).getByText('No payment covers this yet.')).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await choose(user, 'Statement', 'Unbilled')
    await user.click(row('GRAB* A-7XK2 150.000'))
    box = within(screen.getByLabelText('Payments covering this'))
    expect(box.getByText("From Andi's deposit")).toBeTruthy()
    expect(box.getByText('− 150.000')).toBeTruthy()
  })

  it('X-04 delete with a payment: confirm says where the money goes; row removed; payment back to To assign', async () => {
    const { user, db } = await open()
    await user.click(row('School books 120.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete transaction' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete this transaction?' })
    expect(within(confirm).getByText('1 payment covers this (Rp 120.000). That money goes back to "To assign".')).toBeTruthy()
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }))
    await user.click(within(screen.getByRole('dialog', { name: 'School books' })).getByRole('button', { name: 'Delete transaction' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Transaction deleted')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'School books 120.000' })).toBeNull())
    expect(await db.transactions.get('t-books')).toBeUndefined()
    const m = await money(db)
    expect(m.unassigned('p-sari')).toBe(120_000)
    expect(within(screen.getByLabelText('Draft or Final')).getByText(/Not fully assigned: 5 Oct 2026 · Bank payment · Rp 120.000/)).toBeTruthy()

    // A payment kept as a deposit: the confirmation says so.
    await user.click(row('IKEA ALAM SUTERA 300.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete transaction' }))
    expect(screen.getByText(/That money goes back to "To assign", or to Andi's deposit for a payment kept as a deposit\./)).toBeTruthy()
  })

  it('X-02 fix amount: saved, and the totals check re-runs; label saved; bad amount refused', async () => {
    const db = await seedScreen()
    await db.transactions.update('k1', { amount: 90_000 })
    const { user } = renderScreen(<TransactionsPage />, { db })
    expect((await screen.findByLabelText('Totals check')).textContent).toBe('Totals check: off by Rp 81.000. Fix or add rows until it matches.')
    await user.click(row('KCI COMMUTER 90.000'))
    const sheet = screen.getByRole('dialog')
    await user.click(within(sheet).getByText('Fix amount, date or description'))
    const amount = within(sheet).getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, 'abc')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).getByText('Enter the amount in whole rupiah.')).toBeTruthy()
    await user.clear(amount)
    await user.type(amount, '9.000')
    await user.type(within(sheet).getByLabelText('Label'), 'Train')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. Totals check re-run for the Oct 2026 statement.')
    await waitFor(() => expect(screen.getByLabelText('Totals check').textContent).toBe('Totals check: matches the statement ✓'))
    expect(await db.transactions.get('k1')).toMatchObject({ amount: 9_000, label: 'Train' })
    expect(row('Train 9.000')).toBeTruthy()

    // Below what payments cover: refused with the reason.
    await user.click(row('IKEA ALAM SUTERA 300.000'))
    const s2 = screen.getByRole('dialog')
    await user.click(within(s2).getByText('Fix amount, date or description'))
    await user.clear(within(s2).getByLabelText('Amount'))
    await user.type(within(s2).getByLabelText('Amount'), '100000')
    await user.click(within(s2).getByRole('button', { name: 'Save' }))
    expect(await within(s2).findByText(/Payments cover Rp 300.000 of this row/)).toBeTruthy()
    await user.click(within(s2).getByRole('button', { name: 'Cancel' }))
    await user.click(row('Train 9.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
  })

  it('X-03 add a missing transaction: to the selected statement, source You; refund stored negative', async () => {
    const { user, db } = await open()
    await user.click(screen.getByRole('button', { name: '+ Add a missing transaction' }))
    let sheet = screen.getByRole('dialog', { name: 'Add a missing transaction' })
    expect(within(sheet).getByText('Goes to Oct 2026 statement. The totals check runs again after you save.')).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Add' }))
    expect(within(sheet).getByText('Add an amount and a description.')).toBeTruthy()
    await user.type(within(sheet).getByLabelText('Amount'), '12.500')
    await user.type(within(sheet).getByLabelText('Description'), 'kopi kenangan')
    await user.click(within(sheet).getByRole('button', { name: 'Sari' }))
    await user.click(within(sheet).getByRole('button', { name: 'Add' }))
    await screen.findByText('Added. Totals check updated.')
    expect(await screen.findByRole('button', { name: 'KOPI KENANGAN 12.500' })).toBeTruthy()
    expect(within(row('KOPI KENANGAN 12.500')).getByText('You')).toBeTruthy()
    expect(screen.getByLabelText('Totals check').textContent).toContain('off by Rp 12.500')
    const added = (await db.transactions.toArray()).find((t) => t.description === 'KOPI KENANGAN')
    expect(added).toMatchObject({ statementId: OCT.id, amount: 12_500, ownerId: 'sari', tagSource: 'manual', date: '2026-10-12' })

    await choose(user, 'Statement', 'Unbilled')
    await user.click(screen.getByRole('button', { name: '+ Add a missing transaction' }))
    sheet = screen.getByRole('dialog', { name: 'Add a missing transaction' })
    await user.click(within(sheet).getByRole('button', { name: 'Refund' }))
    await user.type(within(sheet).getByLabelText('Amount'), '5000')
    await user.type(within(sheet).getByLabelText('Description'), 'REFUND TOKO')
    await user.click(within(sheet).getByRole('button', { name: 'Add' }))
    await screen.findByText('Added')
    expect(await screen.findByRole('button', { name: 'REFUND TOKO −5.000' })).toBeTruthy()
  })

  it('I-07 convert a REVERSAL CICILAN row to installment: confirmation, then original and reversal not counted', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.bulkPut([
      tx('orig', 'bca-sep', '2026-09-03', 'BLIBLI.COM *121 JAKARTA', 1_200_000, 'sari'),
      tx('rev', OCT.id, '2026-09-20', 'REVERSAL CICILAN BCA BLIBLI.COM *121', -1_200_000, null, { kind: 'reversal' }),
      tx('inst', OCT.id, '2026-09-20', 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM', 200_000, null, { kind: 'installment', installment: { n: 1, of: 6 } }),
      tx('rev2', OCT.id, '2026-09-21', 'REVERSAL CICILAN BCA TOKO *999', -50_000, null, { kind: 'reversal' }),
    ])
    await db.payments.put(pay('p1', '2026-09-25', 500_000, { allocations: [{ txId: 'orig', amount: 500_000 }], depositOwnerId: 'andi' }))
    const { user } = renderScreen(<TransactionsPage />, { db })

    await user.click(await screen.findByRole('button', { name: 'REVERSAL CICILAN BCA TOKO *999 −50.000' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Convert to installment' }))
    expect(await screen.findByText(/The original purchase \(same amount, same \*ref\) is not on this card yet/)).toBeTruthy()
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Convert' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await user.click(row('REVERSAL CICILAN BCA BLIBLI.COM *121 −1.200.000'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Convert to installment' }))
    const preview = await screen.findByLabelText('Conversion preview')
    expect(within(preview).getByText(/BLIBLI.COM \*121 JAKARTA/)).toBeTruthy()
    expect(within(preview).getByText('Installment 1/6: Rp 200.000 a month for 6 months, for Sari.')).toBeTruthy()
    expect(within(preview).getByText(/Rp 500.000 of payments on the original move to installment 1\/6/)).toBeTruthy()
    expect(within(preview).getByText(/someone else's deposit/)).toBeTruthy() // p1's deposit is Andi's: conflict
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Convert' }))
    await screen.findByText('Converted. A payment leftover went back to "Decide later".')
    await waitFor(() => expect(within(row('REVERSAL CICILAN BCA BLIBLI.COM *121 −1.200.000')).getByText('Not counted')).toBeTruthy())
    expect(within(row('CICILAN BCA KE 01 DARI 06, BLIBLI.COM 200.000')).getByText('Sari')).toBeTruthy()
    expect(within(row('CICILAN BCA KE 01 DARI 06, BLIBLI.COM 200.000')).getByText('Paid')).toBeTruthy()

    await user.click(row('REVERSAL CICILAN BCA BLIBLI.COM *121 −1.200.000'))
    expect(within(screen.getByRole('dialog')).getByText(/This reversal cancels BLIBLI.COM \*121 JAKARTA/)).toBeTruthy()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await choose(user, 'Statement', 'Sep 2026 statement')
    expect(within(row('BLIBLI.COM *121 JAKARTA 1.200.000')).getByText('Moved to installment')).toBeTruthy()
    await choose(user, 'Kind', 'Moved to installment')
    expect(rowNames()).toEqual(['BLIBLI.COM *121 JAKARTA 1.200.000'])
    await user.click(row('BLIBLI.COM *121 JAKARTA 1.200.000'))
    expect(within(screen.getByRole('dialog')).getByText(/Moved to installment. Not counted./)).toBeTruthy()
    const p1 = await db.payments.get('p1')
    expect(p1).toMatchObject({ allocations: [{ txId: 'inst', amount: 200_000 }] })
    expect(p1?.depositOwnerId).toBeUndefined()
  })
})

describe('bulk select', () => {
  it('set owner on many rows: paid rows skipped with a note; rows set by hand only when ticked; mark reviewed', async () => {
    const { user, db } = await open()
    await db.transactions.update('g1', { tagSource: 'manual' })
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(row('IKEA ALAM SUTERA 300.000')) // paid by Andi's payment
    await user.click(row('GRAB* A-1PQ9 25.000')) // set by hand
    await user.click(row('SHOPEE.CO.ID *AP1 JAKARTA 55.201'))
    await user.click(row('BIAYA ADM KARTU 15.000'))
    await user.click(row('BIAYA ADM KARTU 15.000')) // untick
    expect(row('IKEA ALAM SUTERA 300.000').getAttribute('aria-pressed')).toBe('true')
    const bar = within(screen.getByRole('toolbar', { name: 'Selected rows' }))
    expect(bar.getByText('3 rows selected')).toBeTruthy()
    await user.click(bar.getByRole('button', { name: 'Set owner' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Set owner of 3 rows' }))
    expect(sheet.queryByRole('button', { name: 'Bima' })).toBeNull()
    await user.click(sheet.getByRole('button', { name: 'Sari' }))
    const preview = within(await screen.findByLabelText('Bulk preview'))
    expect(preview.getByText('1 row will change to Sari.')).toBeTruthy()
    expect(preview.getByText('1 row with a payment left as they are; change them one by one.')).toBeTruthy()
    await user.click(preview.getByRole('checkbox', { name: /Also change 1 row you tagged by hand/ }))
    await user.click(sheet.getByRole('button', { name: 'Apply to 2 rows' }))
    await screen.findByText('Sari set on 2 rows. 1 row with a payment skipped.')
    expect((await db.transactions.get('c1'))).toMatchObject({ ownerId: 'sari', tagSource: 'manual' })
    expect((await db.transactions.get('g1'))?.ownerId).toBe('sari')
    expect((await db.transactions.get('t-ikea'))?.ownerId).toBe('andi')
    expect(screen.queryByRole('toolbar')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(within(screen.getByRole('toolbar')).getByText('9 rows selected')).toBeTruthy()
    await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Mark reviewed' }))
    await screen.findByText('6 rows marked reviewed')
    const rows = await db.transactions.where('statementId').equals(OCT.id).toArray()
    expect(rows.every((t) => t.tagSource === 'manual' && !t.check)).toBe(true)
    expect(rows.find((t) => t.id === 't-ikea')?.ownerId).toBe('andi')

    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('button', { name: 'Select all shown' }))
    await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Mark reviewed' }))
    await screen.findByText('Already reviewed')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('bulk: Cancel and no rows to change', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(row('School books 120.000')) // Sari's, set by hand
    await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Set owner' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sari' }))
    expect(await screen.findByText('No rows to change.')).toBeTruthy()
    expect(screen.getByText("1 row already Sari's.")).toBeTruthy()
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply to 0 rows' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })
})

describe('view helpers', () => {
  it('statement names, default statement, amount parsing, owner search', async () => {
    const db = await seedScreen()
    const ledger = await loadLedger(db, 'bca')
    expect(statementName(undefined)).toBe('Statement')
    expect(defaultStatementId(ledger, 'bca')).toBe(OCT.id)
    expect(defaultStatementId({ statements: [{ id: UNB, cardId: 'bca', kind: 'unbilled' }] }, 'bca')).toBe(UNB)
    expect(rowViews(ledger, 'nope')).toEqual([])
    expect(parseAmount('Rp 1.234.567')).toBe(1_234_567)
    expect(parseAmount('0')).toBeNull()
    const rows = rowViews(ledger, OCT.id)
    expect(applyFilters(rows, { ...NO_FILTERS, q: 'sari' }, (id) => (id === 'sari' ? 'Sari' : 'Andi')).length).toBe(4)
    expect(searchMatches(rows[0], '  ')).toBe(true)
    expect(applyFilters(rows, { ...NO_FILTERS, owner: 'none' }, () => '')).toEqual([])
    expect(applyFilters(rows, { ...NO_FILTERS, kind: 'purchase' }, () => '').length).toBe(6)
    expect(applyFilters(rows, { ...NO_FILTERS, kind: 'reversal' }, () => '')).toEqual([])
  })
})
