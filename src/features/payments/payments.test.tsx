// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMoney, depositLeftOf, ownerDepositLeft, paidOf, unassignedOf } from '../../domain/amounts'
import { ownerBill } from '../../domain/bill'
import { draftIssues } from '../../domain/draft'
import { applyLinks, matchManualPayments } from '../../domain/matching'
import { bankStatus } from '../../domain/payments'
import type { Ledger } from '../../domain/types'
import type { NewDb } from '../../data/db'
import { loadLedger } from '../../data/repo'
import { freshNewDb, uniqueName } from '../../../test/data/oldDb'
import { handPayments, householdLedger, IDS, seedHousehold, TODAY } from '../../../test/payments/household'
import { OCT, pay, SEP, seedCards, tx, UNB } from '../../../test/transactions/ledger'
import { Shell } from '../Shell'
import { TransactionsPage } from '../transactions/TransactionsPage'
import { PaymentsRoutes } from './PaymentsRoutes'
import { deleteEffect, ownerDeposits, paymentLists, typedRupiah } from './view'

// Synthetic data only: the fictional household (test/payments/household.ts) and the small "BCA Keluarga" ledger
// (test/transactions/ledger.ts: Andi, Sari, archived Bima; Sep and Oct statements and Unbilled; a Mandiri card).

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
const where = () => screen.getByTestId('where').textContent

function renderAt(path: string, db: NewDb) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell db={db} oldName={uniqueName('CCBillDB-none')}>
        <Routes>
          <Route path="/payments/*" element={<PaymentsRoutes />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </Shell>
    </MemoryRouter>,
  )
  return { user, db }
}

const toast = () => screen.getByRole('status').textContent
const left = () => screen.getByLabelText('Left to assign').textContent
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
const tab = (name: RegExp) => screen.getByRole('tab', { name })
const panel = () => screen.getByRole('tabpanel')
const amountFor = (title: string) => screen.getByRole('textbox', { name: `Amount for ${title}` }) as HTMLInputElement
/** Owner chips of "Who is this payment for?" (the leftover's deposit chips carry the same names). */
const whoGroup = () => screen.getByRole('group', { name: 'Who is this payment for?' })
const who = (name: string) => within(whoGroup()).getByRole('button', { name })
const queryWho = (name: string) => within(whoGroup()).queryByRole('button', { name })
const findWho = async (name: string) => within(await screen.findByRole('group', { name: 'Who is this payment for?' })).getByRole('button', { name })

/** The household with its two hand-recorded payments, linked the way an import links them (18 Oct ↔ 20 Oct line). */
function householdWithHand(): Ledger {
  const l = householdLedger()
  const payments = [...l.payments, ...handPayments()]
  return { ...l, payments: applyLinks(payments, matchManualPayments(payments)) }
}

/**
 * Andi's charges for the assign mechanics: Sep 2 100.000, Sep 5 150.000, Oct 3 1.252.000, Oct 4 80.000, Unbilled
 * 14 Oct 60.000 (open up to the payment date), Unbilled 25 Oct 40.000 (after it), Sep 1 70.000 (paid by another
 * payment); Sari's Oct 5 90.000. Payment p5: an Unbilled line of 500.000 on 20 Oct.
 */
async function seedAssign(db: NewDb = freshNewDb()) {
  await seedCards(db)
  await db.transactions.bulkPut([
    tx('a1', SEP.id, '2026-09-02', 'TOKO SATU', 100_000, 'andi'),
    tx('a2', SEP.id, '2026-09-05', 'TOKO DUA', 150_000, 'andi'),
    tx('a3', OCT.id, '2026-10-03', 'TOKO TIGA', 1_252_000, 'andi'),
    tx('a4', OCT.id, '2026-10-04', 'TOKO EMPAT', 80_000, 'andi'),
    tx('a5', UNB, '2026-10-14', 'TOKO LIMA', 60_000, 'andi'),
    tx('a6', UNB, '2026-10-25', 'TOKO ENAM', 40_000, 'andi'),
    tx('a7', SEP.id, '2026-09-01', 'TOKO LUNAS', 70_000, 'andi'),
    tx('s1', OCT.id, '2026-10-05', 'SALON', 90_000, 'sari'),
  ])
  await db.payments.bulkPut([
    pay('p-old', '2026-09-10', 70_000, { source: 'statement', statementId: SEP.id, allocations: [{ txId: 'a7', amount: 70_000 }], description: 'PEMBAYARAN 10/09' }),
    pay('p5', '2026-10-20', 500_000, { source: 'unbilled', statementId: UNB, description: 'TRANSFER 20/10' }),
  ])
  return db
}

describe('Payments list', () => {
  it('P-19 tabs: To assign / Assigned / Not on a statement (the 5 Sep Bima payment) / Possible duplicates / Deposits', async () => {
    const db = await seedHousehold(freshNewDb(), householdWithHand())
    const { user } = renderAt('/payments', db)
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeTruthy()
    await waitFor(() => expect(tab(/^To assign · 2$/)).toBeTruthy())
    expect(tab(/^To assign/).getAttribute('aria-selected')).toBe('true')
    const toAssign = within(panel()).getAllByRole('link').map((a) => a.getAttribute('aria-label'))
    expect(toAssign).toEqual(['Rp 1.500.000 30 Oct 2026', 'Rp 2.000.000 18 Oct 2026'])
    expect(within(panel()).getByText('Rp 3.500.000 still to assign.')).toBeTruthy()
    // The 18 Oct hand payment is shown once (the 20 Oct bank line is the same money), matched to the Nov statement.
    expect(within(panel()).getByText('Matched to Nov 2026 statement ✓')).toBeTruthy()
    expect(within(panel()).getByText('Nov 2026 statement · PEMBAYARAN - MBCA')).toBeTruthy()

    await user.click(tab(/^Not on a statement · 1$/))
    expect(within(panel()).getByText('Not on Sep 2026 statement')).toBeTruthy()
    expect(within(panel()).getByText('intended')).toBeTruthy()

    await user.click(tab(/^Assigned/))
    const assigned = await loadLedger(db, 'bca')
    expect(within(panel()).getAllByRole('link')).toHaveLength(paymentLists(assigned, 'bca').assigned.length)
    expect(within(panel()).getAllByText('Fully assigned ✓').length).toBeGreaterThan(0)

    await user.click(tab(/^Possible duplicates$/))
    expect(within(panel()).getByText('No payment looks like it was counted twice.')).toBeTruthy()
    // The Sep payment's leftover became Sari's deposit at the Oct conversion; it is used up.
    await user.click(tab(/^Deposits · 1$/))
    const sari = within(panel()).getByRole('region', { name: "Sari's deposit" })
    expect(within(sari).getByText('used, 0 left')).toBeTruthy()
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(screen.queryByRole('link', { name: 'Old payments screen' })).toBeNull()
  })

  it('shows the way to Settings when there is no card', async () => {
    renderAt('/payments', freshNewDb())
    expect(await screen.findByText('Add a card in Settings first.')).toBeTruthy()
  })
})

describe('the full-screen assign page', () => {
  it('U-07 / D-01 the 30 Oct 1.500.000: Fill oldest first pays Sari\'s 928.734; 571.266 becomes her deposit', async () => {
    const db = await seedHousehold(freshNewDb(), householdWithHand())
    const before = await loadLedger(db, 'bca')
    expect(ownerBill(before, 'Sari', 'bca-2026-11', TODAY)).toMatchObject({ mustPay: 928_734, depositWaiting: 0 })
    const { user } = renderAt('/payments', db)
    await user.click(await screen.findByRole('link', { name: 'Rp 1.500.000 30 Oct 2026' }))
    expect(where()).toBe(`/payments/${encodeURIComponent(IDS.OCT30_LINE)}`)
    // Full screen: a page, not a sheet over the list.
    expect(await screen.findByRole('region', { name: 'Assign payment' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.overlay')).toBeNull()
    // Focus moves to the page's heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Assign payment' }))
    expect(screen.queryByRole('heading', { name: 'Payments' })).toBeNull()
    expect(screen.getByText('Nov 2026 statement')).toBeTruthy()
    expect(left()).toBe('1.500.000')
    // P-12 a bank payment: amount and date read-only.
    expect(screen.queryByLabelText('Amount', { selector: 'input' })).toBeNull()
    expect(screen.getByLabelText('Amount').textContent).toBe('1.500.000')
    expect(screen.getByText("From the bank: PEMBAYARAN - MBCA. Amount and date can't be changed.")).toBeTruthy()
    expect(screen.getByText('Pick whose charges this payment was for.')).toBeTruthy()

    await user.click(who('Sari'))
    await user.click(screen.getByRole('button', { name: 'Fill oldest first' }))
    expect(left()).toBe('571.266')
    expect(amountFor('CICILAN BCA KE 02 DARI 06, BLIBLI.COM').value).toBe('608.734')
    expect(amountFor('TOKOPEDIA JAKARTA').value).toBe('320.000')
    expect(screen.getByText('571.266 left over.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decide later' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(screen.getByRole('group', { name: 'Leftover' })).getByRole('button', { name: 'Sari' }))
    expect(document.querySelectorAll('select')).toHaveLength(0)
    await user.click(save())

    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe('Payment saved')
    const after = await loadLedger(db, 'bca')
    const state = computeMoney(after)
    const line = after.payments.find((p) => p.id === IDS.OCT30_LINE)!
    expect(line).toMatchObject({ depositOwnerId: 'Sari', forOwnerIds: ['Sari'] })
    expect([unassignedOf(line), depositLeftOf(state, line), ownerDepositLeft(state, 'Sari')]).toEqual([571_266, 571_266, 571_266])
    expect(ownerBill(after, 'Sari', 'bca-2026-11', TODAY)).toMatchObject({ mustPay: 0, settled: true, depositWaiting: 571_266 })
    // F-05 kept as a deposit: it no longer blocks Nov.
    expect(draftIssues(after, 'bca-2026-11').blockingPayments).not.toContain(IDS.OCT30_LINE)

    expect(tab(/^To assign · 1$/)).toBeTruthy()
    await user.click(tab(/^Deposits/))
    const sari = within(panel()).getByRole('region', { name: "Sari's deposit" })
    expect(within(sari).getByText('Rp 571.266')).toBeTruthy()
    expect(within(sari).getByText('30 Oct 2026 · kept 571.266')).toBeTruthy()
  })

  it('P-01 / P-02 / P-03 groups oldest first, Unbilled last; later and already-paid charges hidden with a count', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/p5', db)
    await user.click(await findWho('Andi'))
    const groups = screen.getAllByRole('button', { expanded: true }).concat(screen.getAllByRole('button', { expanded: false }))
    expect(groups.map((g) => g.querySelector('.t')!.textContent).sort()).toEqual(['Oct 2026 statement', 'Sep 2026 statement', 'Unbilled'])
    expect(Array.from(document.querySelectorAll('.grp .t')).map((e) => e.textContent)).toEqual(['Sep 2026 statement', 'Oct 2026 statement', 'Unbilled'])
    expect(screen.getByLabelText('Hidden charges').textContent).toBe('Oldest statement first. Not shown: 1 charge made after 20 Oct 2026, 1 already fully paid by other payments.')
    expect(screen.queryByRole('button', { name: 'TOKO ENAM' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'TOKO LUNAS' })).toBeNull()
    // Only the first group is open; the others expand on tap.
    expect(screen.getByRole('button', { name: 'TOKO SATU' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'TOKO TIGA' })).toBeNull()
    const oct = within(screen.getByRole('region', { name: 'Oct 2026 statement' })).getByRole('button', { expanded: false })
    expect(oct.textContent).toContain('2 open · 1.332.000')
    await user.click(oct)
    expect(screen.getByRole('button', { name: 'TOKO TIGA' })).toBeTruthy()
    await user.click(oct)
    expect(screen.queryByRole('button', { name: 'TOKO TIGA' })).toBeNull()
  })

  it('P-04 / P-05 / P-08 / P-09 tap caps at what is left, untick first, Pay full, over-assign blocks Save', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/p5', db)
    await user.click(await findWho('Andi'))
    await user.click(within(screen.getByRole('region', { name: 'Oct 2026 statement' })).getByRole('button', { expanded: false }))

    // P-04 open 1.252.000, 500.000 left → 500.000 (partial) and a message.
    await user.click(screen.getByRole('button', { name: 'TOKO TIGA' }))
    expect(amountFor('TOKO TIGA').value).toBe('500.000')
    expect(toast()).toBe('Only 500.000 was left in this payment, so this charge is partly paid.')
    expect(left()).toBe('0')
    // P-05 nothing left.
    await user.click(screen.getByRole('button', { name: 'TOKO EMPAT' }))
    expect(toast()).toBe('This payment is already fully assigned. Untick something first.')
    expect(screen.getByRole('button', { name: 'TOKO EMPAT' }).getAttribute('aria-pressed')).toBe('false')

    // U-07 Left to assign follows the typing.
    fireEvent.change(amountFor('TOKO TIGA'), { target: { value: '300.000' } })
    expect(left()).toBe('200.000')
    // P-08 Pay full after a partial: min(open, current + left) = 500.000; not the full 1.252.000.
    await user.click(screen.getByRole('button', { name: 'Pay full' }))
    expect(amountFor('TOKO TIGA').value).toBe('500.000')
    expect(toast()).toBe('Not enough left in this payment to pay it in full.')

    // P-09 typing more than the payment: error, Save disabled.
    fireEvent.change(amountFor('TOKO TIGA'), { target: { value: '600000' } })
    expect(left()).toBe('−100.000')
    expect(screen.getByRole('alert').textContent).toBe("That's 100.000 more than the payment. Lower an amount.")
    expect(save().disabled).toBe(true)
    // More than is open on a charge is refused too.
    fireEvent.change(amountFor('TOKO TIGA'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'TOKO SATU' }))
    fireEvent.change(amountFor('TOKO SATU'), { target: { value: '120.000' } })
    expect(screen.getByRole('alert').textContent).toBe('More than is open on TOKO SATU. Lower it or tap Pay full.')
    expect(save().disabled).toBe(true)
    fireEvent.change(amountFor('TOKO SATU'), { target: { value: '100.000' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(save().disabled).toBe(false)

    // Back leaves without saving.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect((await db.payments.get('p5'))!.allocations).toEqual([])
  })

  it('P-06 / P-07 Fill oldest first and Pay all in this statement stop when the payment runs out', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/p5', db)
    await user.click(await findWho('Andi'))
    // P-06 500.000 over 5 open charges in date order: 100.000 + 150.000 + 250.000, then it is used up.
    await user.click(screen.getByRole('button', { name: 'Fill oldest first' }))
    expect(toast()).toBe('The payment ran out after 3 of 5 charges.')
    expect([amountFor('TOKO SATU').value, amountFor('TOKO DUA').value, amountFor('TOKO TIGA').value]).toEqual(['100.000', '150.000', '250.000'])
    expect(screen.getByRole('button', { name: 'TOKO EMPAT' }).getAttribute('aria-pressed')).toBe('false')
    expect(left()).toBe('0')

    // P-07 Pay all in the Oct statement, after clearing: 500.000 on 1.252.000, the 80.000 left out.
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(left()).toBe('500.000')
    const oct = screen.getByRole('region', { name: 'Oct 2026 statement' })
    // Cleared, the Oct group folds again (only groups with ticks and the first one stay open).
    await user.click(within(oct).getByRole('button', { expanded: false }))
    await user.click(within(oct).getByRole('button', { name: 'Pay all in this statement' }))
    expect(toast()).toBe('The payment ran out after 1 of 2 charges.')
    expect(amountFor('TOKO TIGA').value).toBe('500.000')
    expect(within(oct).getByRole('button', { expanded: true }).textContent).toContain('1 ticked')

    // Save with nothing left over.
    await user.click(save())
    await waitFor(() => expect(where()).toBe('/payments'))
    const l = await loadLedger(db, 'bca')
    expect(l.payments.find((p) => p.id === 'p5')!.allocations).toEqual([{ txId: 'a3', amount: 500_000 }])
    expect(ownerBill(l, 'andi', OCT.id, TODAY)).toMatchObject({ charges: 1_332_000, alreadyPaid: 500_000, thisRemaining: 832_000 })
  })

  it('P-10 / P-11 one person at a time clears the ticks; "more than one person" adds people and names their rows', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/p5', db)
    await user.click(await findWho('Andi'))
    await user.click(screen.getByRole('button', { name: 'TOKO SATU' }))
    expect(left()).toBe('400.000')
    // Archived Bima is not offered.
    expect(queryWho('Bima')).toBeNull()
    await user.click(who('Sari'))
    expect(who('Andi').getAttribute('aria-pressed')).toBe('false')
    expect(left()).toBe('500.000')
    expect(screen.queryByRole('button', { name: 'TOKO SATU' })).toBeNull()
    expect(screen.getByRole('button', { name: 'SALON' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'SALON' }))
    await user.click(screen.getByRole('button', { name: 'It was for more than one person' }))
    expect(screen.getByText('Who is this payment for? (several people)')).toBeTruthy()
    await user.click(who('Andi'))
    expect(['Andi', 'Sari'].map((n) => who(n).getAttribute('aria-pressed'))).toEqual(['true', 'true'])
    expect(left()).toBe('410.000')
    expect(screen.getByRole('button', { name: 'TOKO SATU' }).textContent).toContain('2 Sep 2026 · Andi · 100.000 open')
    await user.click(screen.getByRole('button', { name: 'TOKO SATU' }))
    expect(left()).toBe('310.000')
    // Taking Sari off drops her ticks only.
    await user.click(who('Sari'))
    expect(left()).toBe('400.000')

    // F-06 a leftover on "Decide later" keeps the bill Draft.
    await user.click(save())
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe('Saved. 400.000 is still unassigned, so the bill stays Draft.')
    const l = await loadLedger(db, 'bca')
    expect(l.payments.find((p) => p.id === 'p5')).toMatchObject({ allocations: [{ txId: 'a1', amount: 100_000 }], forOwnerIds: ['andi'] })
    expect(l.payments.find((p) => p.id === 'p5')).not.toHaveProperty('depositOwnerId')
  })

  it('P-18 an existing split payment opens with its people and amounts, and the edit is saved', async () => {
    const db = await seedAssign()
    await db.payments.put(pay('split', '2026-10-10', 200_000, { allocations: [{ txId: 'a4', amount: 80_000 }, { txId: 's1', amount: 90_000 }], depositOwnerId: 'sari' }))
    const { user } = renderAt('/payments/split', db)
    expect(await screen.findByText('Who is this payment for? (several people)')).toBeTruthy()
    expect(screen.getByText('Recorded by hand')).toBeTruthy()
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('200.000')
    expect(left()).toBe('30.000')
    expect(amountFor('SALON').value).toBe('90.000')
    expect(within(screen.getByRole('group', { name: 'Leftover' })).getByRole('button', { name: 'Sari' }).getAttribute('aria-pressed')).toBe('true')
    // Lower Sari's part; the leftover grows; still her deposit.
    fireEvent.change(amountFor('SALON'), { target: { value: '50.000' } })
    expect(left()).toBe('70.000')
    await user.click(save())
    await waitFor(() => expect(where()).toBe('/payments'))
    const l = await loadLedger(db, 'bca')
    const p = l.payments.find((x) => x.id === 'split')!
    expect(p).toMatchObject({ allocations: [{ txId: 'a4', amount: 80_000 }, { txId: 's1', amount: 50_000 }], depositOwnerId: 'sari' })
    // D-02 Sari's 5 Oct charge is before the 10 Oct deposit: the deposit doesn't pay the 40.000 still open.
    const state = computeMoney(l)
    expect([paidOf(state, 's1'), ownerDepositLeft(state, 'sari')]).toEqual([50_000, 70_000])
  })

  it('shows "no longer exists" for an unknown payment', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/nope', db)
    expect(await screen.findByText('This payment no longer exists.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to Payments' }))
    expect(where()).toBe('/payments')
  })
})

describe('recording a payment by hand', () => {
  it('P-13 18 Oct 2.000.000 for Andi is matched to the 20 Oct bank line (counted once); leftover to Andi\'s deposit', async () => {
    const db = await seedHousehold(freshNewDb())
    const { user } = renderAt('/payments', db)
    await user.click(await screen.findByRole('link', { name: '+ Record a payment by hand' }))
    expect(await screen.findByRole('region', { name: 'Record a payment' })).toBeTruthy()
    expect(screen.getByText('Recorded by hand. When the statement prints the same amount within 5 days, the two are matched and counted once.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    await user.click(who('Andi'))
    // No amount yet: tapping asks for it.
    await user.click(screen.getByRole('button', { name: 'Fill oldest first' }))
    fireEvent.change(screen.getByLabelText('Date you transferred'), { target: { value: '2026-10-18' } })
    const tokens = screen.getAllByRole('button').filter((b) => b.classList.contains('atog'))
    await user.click(tokens[0])
    expect(toast()).toBe('Enter the amount first.')
    await user.type(screen.getByLabelText('Amount'), '2000000')
    expect(left()).toBe('2.000.000')
    await user.type(screen.getByLabelText('Note (optional)'), 'Transfer from Andi')
    await user.click(screen.getByRole('button', { name: 'Fill oldest first' }))
    const remaining = left()!
    await user.click(within(screen.getByRole('group', { name: 'Leftover' })).getByRole('button', { name: 'Andi' }))
    await user.click(save())

    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe("Saved and matched to the bank line of 20 Oct 2026. It's counted once.")
    const l = await loadLedger(db, 'bca')
    const hand = l.payments.find((p) => p.source === 'manual')!
    expect(hand).toMatchObject({ date: '2026-10-18', amount: 2_000_000, linkedStatementLine: IDS.OCT20_LINE, depositOwnerId: 'Andi', description: 'Transfer from Andi' })
    expect(bankStatus(l, hand)).toEqual({ kind: 'linked', statementId: 'bca-2026-11' })
    const state = computeMoney(l)
    expect(unassignedOf(hand)).toBe(typedRupiah(remaining))
    // Andi's deposit (18 Oct) pays his 25 Oct installment 5/12; the rest waits (the scenario's 133.430 + the 27.000
    // pending Grab that this ledger doesn't have).
    expect(ownerBill(l, 'Andi', 'bca-2026-11', TODAY)).toMatchObject({ thisRemaining: 0, mustPay: 0, settled: true, depositWaiting: 160_430 })
    expect(ownerDepositLeft(state, 'Andi')).toBe(160_430)
    // Counted once: the 20 Oct line is not in any list; the hand payment is under Assigned.
    await user.click(tab(/^Assigned/))
    expect(within(panel()).getByRole('link', { name: 'Rp 2.000.000 18 Oct 2026' })).toBeTruthy()
    expect(within(panel()).queryByRole('link', { name: 'Rp 2.000.000 20 Oct 2026' })).toBeNull()
  })

  it('on a second card the card can be picked; the page resets for it', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/new', db)
    await user.click(await screen.findByRole('button', { name: /^Card:/ }))
    await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: /Mandiri Pribadi/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Card: Mandiri Pribadi/ })).toBeTruthy())
    expect(who('Andi')).toBeTruthy()
    expect(queryWho('Sari')).toBeNull()
  })
})

describe('payment actions', () => {
  it('P-15 the 5 Sep Bima payment: Keep waiting → "Still waiting", no longer missing', async () => {
    const db = await seedHousehold(freshNewDb(), householdWithHand())
    const { user } = renderAt('/payments', db)
    await user.click(await screen.findByRole('tab', { name: /^Not on a statement/ }))
    await user.click(within(panel()).getByRole('link', { name: 'Rp 300.000 5 Sep 2026' }))
    const bank = await screen.findByRole('region', { name: 'At the bank' })
    expect(within(bank).getByText('Not on Sep 2026 statement')).toBeTruthy()
    expect(within(bank).getByText("The Sep 2026 statement doesn't show it. What happened?")).toBeTruthy()
    // Only one card: nowhere to move it.
    expect(within(bank).queryByRole('button', { name: 'Paid to another card' })).toBeNull()
    expect(draftIssues(await loadLedger(db, 'bca'), 'bca-2026-09').missingPayments).toEqual(['hand-0905'])
    await user.click(within(bank).getByRole('button', { name: 'Keep waiting' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe("OK. It's checked again when the next statement arrives.")
    const l = await loadLedger(db, 'bca')
    expect(draftIssues(l, 'bca-2026-09').missingPayments).toEqual([])
    await user.click(tab(/^Not on a statement/))
    expect(within(panel()).getByText('Still waiting (not on Sep 2026)')).toBeTruthy()
  })

  it('P-17 Transfer failed, delete: asks first, says what becomes unpaid, then deletes', async () => {
    const db = await seedHousehold(freshNewDb(), householdWithHand())
    const { user } = renderAt('/payments/hand-0905', db)
    await user.click(await screen.findByRole('button', { name: 'Transfer failed, delete' }))
    const sheet = screen.getByRole('dialog', { name: 'Delete this payment?' })
    expect(within(sheet).getByText('5 Sep 2026 · Rp 300.000')).toBeTruthy()
    expect(within(sheet).getByText('No charge becomes unpaid.')).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete payment' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe('Payment deleted')
    expect(await db.payments.get('hand-0905')).toBeUndefined()
  })

  it('P-17 deleting a matched, assigned hand payment: the charge is unpaid, the bank line returns, Oct goes back to Draft', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.put(tx('t1', OCT.id, '2026-10-03', 'IKEA ALAM SUTERA', 300_000, 'andi'))
    await db.payments.bulkPut([
      pay('line', '2026-10-06', 300_000, { source: 'statement', statementId: OCT.id, description: 'PEMBAYARAN 06/10' }),
      pay('hand', '2026-10-05', 300_000, { linkedStatementLine: 'line', allocations: [{ txId: 't1', amount: 300_000 }], forOwnerIds: ['andi'] }),
    ])
    const before = await loadLedger(db, 'bca')
    expect(draftIssues(before, OCT.id).final).toBe(true)
    expect(deleteEffect(before, 'hand')).toMatchObject({ drafts: ['Oct 2026'], unpaid: [{ before: 0, after: 300_000 }] })
    const { user } = renderAt('/payments/hand', db)
    expect(await screen.findByText("Matched to the bank's payment line, so the amount and date can't be changed.")).toBeTruthy()
    expect(screen.queryByLabelText('Date you transferred')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete payment' }))
    const sheet = screen.getByRole('dialog', { name: 'Delete this payment?' })
    expect(within(within(sheet).getByLabelText('Becomes unpaid')).getByText('3 Oct 2026 · IKEA ALAM SUTERA')).toBeTruthy()
    expect(within(sheet).getByText('300.000 left')).toBeTruthy()
    expect(within(sheet).getByText('The bank line of 6 Oct 2026 (Rp 300.000) goes back to To assign.')).toBeTruthy()
    expect(within(sheet).getByText('The Oct 2026 statement goes back to Draft until the payment is assigned again.')).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    const after = await loadLedger(db, 'bca')
    expect(ownerBill(after, 'andi', OCT.id, TODAY).mustPay).toBe(300_000)
    expect(draftIssues(after, OCT.id).blockingPayments).toEqual(['line'])
    expect(tab(/^To assign · 1$/)).toBeTruthy()
  })

  it('P-16 Paid to another card: moves to Mandiri with Andi mapped by name, assignments cleared', async () => {
    const db = await seedCards(freshNewDb())
    await db.statements.put({ ...OCT, id: 'bca-nov', statementDate: '2026-11-12', dueDate: '2026-11-28' })
    await db.transactions.put(tx('t1', OCT.id, '2026-10-03', 'IKEA', 300_000, 'andi'))
    await db.payments.put(pay('h', '2026-10-15', 300_000, { allocations: [{ txId: 't1', amount: 300_000 }], forOwnerIds: ['andi'] }))
    const { user } = renderAt('/payments/h', db)
    const bank = await screen.findByRole('region', { name: 'At the bank' })
    expect(within(bank).getByText('Not on Nov 2026 statement')).toBeTruthy()
    await user.click(within(bank).getByRole('button', { name: 'Paid to another card' }))
    const sheet = screen.getByRole('dialog', { name: 'Paid to which card?' })
    expect(within(within(sheet).getByLabelText('Becomes unpaid')).getByText('3 Oct 2026 · IKEA')).toBeTruthy()
    expect(within(sheet).getByText('300.000 left')).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: /Mandiri Pribadi/ }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe('Moved to Mandiri Pribadi. Assign it there.')
    expect(await db.payments.get('h')).toMatchObject({ cardId: 'mdr', allocations: [], forOwnerIds: ['mdr-andi'], waiting: true })
    expect(ownerBill(await loadLedger(db, 'bca'), 'andi', OCT.id, TODAY).mustPay).toBe(300_000)
    // The list now shows Mandiri, where it waits to be assigned.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Card: Mandiri Pribadi/ })).toBeTruthy())
    expect(await within(panel()).findByRole('link', { name: 'Rp 300.000 15 Oct 2026' })).toBeTruthy()
  })

  it('possible duplicate: listed on its own; "keep both" warns first, then waits', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.put(tx('t1', OCT.id, '2026-10-03', 'IKEA', 300_000, 'andi'))
    await db.payments.bulkPut([
      pay('line', '2026-10-06', 300_000, { source: 'statement', statementId: OCT.id, allocations: [{ txId: 't1', amount: 300_000 }] }),
      pay('hand', '2026-10-05', 300_000, { forOwnerIds: ['andi'] }),
    ])
    const { user } = renderAt('/payments', db)
    await user.click(await screen.findByRole('tab', { name: /^Possible duplicates · 1$/ }))
    expect(within(panel()).getByText('Same amount as the 6 Oct 2026 bank line')).toBeTruthy()
    await user.click(within(panel()).getByRole('link', { name: 'Rp 300.000 5 Oct 2026' }))
    const bank = await screen.findByRole('region', { name: 'At the bank' })
    expect(within(bank).getByText(/already assigned. If that is this transfer, the money is counted twice/)).toBeTruthy()
    await user.click(within(bank).getByRole('button', { name: 'Same transfer, delete this one' }))
    const del = screen.getByRole('dialog', { name: 'Delete this payment?' })
    expect(within(del).getByText('The bank line of 6 Oct 2026 (Rp 300.000) keeps its assignments.')).toBeTruthy()
    await user.click(within(del).getByRole('button', { name: 'Keep it' }))
    await user.click(within(bank).getByRole('button', { name: 'Different transfers, keep both' }))
    const sheet = screen.getByRole('dialog', { name: 'Keep both payments?' })
    expect(within(sheet).getByText(/counted twice and the bills come out too low/)).toBeTruthy()
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await user.click(within(bank).getByRole('button', { name: 'Different transfers, keep both' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep both' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(toast()).toBe('Kept both. This one waits for its own bank line.')
    expect(draftIssues(await loadLedger(db, 'bca'), OCT.id).possibleDuplicatePayments).toEqual([])
    expect(tab(/^Possible duplicates$/)).toBeTruthy()
  })

  it('a bank line matched to a hand-recorded payment opens that payment instead (counted once)', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.put(tx('t1', OCT.id, '2026-10-03', 'IKEA', 300_000, 'andi'))
    await db.payments.bulkPut([
      pay('line', '2026-10-06', 300_000, { source: 'statement', statementId: OCT.id }),
      pay('hand', '2026-10-05', 300_000, { linkedStatementLine: 'line', allocations: [{ txId: 't1', amount: 300_000 }] }),
    ])
    renderAt('/payments/line', db)
    await waitFor(() => expect(where()).toBe('/payments/hand'))
    expect(await screen.findByText('Matched to Oct 2026 statement ✓')).toBeTruthy()
  })

  it('a double tap on Save writes one payment', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/new', db)
    await user.type(await screen.findByLabelText('Amount'), '100000')
    fireEvent.change(screen.getByLabelText('Date you transferred'), { target: { value: '2026-10-15' } })
    await user.click(who('Andi'))
    await user.click(screen.getByRole('button', { name: 'TOKO SATU' }))
    fireEvent.click(save())
    fireEvent.click(save())
    await waitFor(() => expect(where()).toBe('/payments'))
    expect((await db.payments.toArray()).filter((p) => p.source === 'manual')).toHaveLength(1)
  })

  it('an Unbilled payment line the statement did not show: Keep waiting', async () => {
    const db = await seedCards(freshNewDb())
    await db.payments.put(pay('u', '2026-10-01', 50_000, { source: 'unbilled', statementId: UNB }))
    expect(draftIssues(await loadLedger(db, 'bca'), OCT.id).notOnStatementPayments).toEqual(['u'])
    const { user } = renderAt('/payments/u', db)
    const bank = await screen.findByRole('region', { name: 'At the bank' })
    expect(within(bank).getByText('Not on the Oct 2026 statement')).toBeTruthy()
    await user.click(within(bank).getByRole('button', { name: 'Delete it' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }))
    await user.click(within(bank).getByRole('button', { name: 'Keep waiting' }))
    await waitFor(() => expect(where()).toBe('/payments'))
    expect(draftIssues(await loadLedger(db, 'bca'), OCT.id).notOnStatementPayments).toEqual([])
  })

  it('a failed write shows its reason on the page', async () => {
    const db = await seedAssign()
    const { user } = renderAt('/payments/p5', db)
    await user.click(await findWho('Andi'))
    await user.click(screen.getByRole('button', { name: 'TOKO SATU' }))
    await db.payments.delete('p5')
    await user.click(save())
    expect(await screen.findByText('This payment no longer exists.')).toBeTruthy()
  })
})

describe('deposits', () => {
  it('D-03 / D-05 deposits apply in date order; a payment with nothing to pay becomes a deposit; a used one shows 0 left', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.bulkPut([tx('c1', UNB, '2026-10-16', 'GRAB', 320_000, 'sari'), tx('c2', UNB, '2026-10-18', 'APOTEK', 100_000, 'sari')])
    await db.payments.bulkPut([
      pay('d1', '2026-10-10', 300_000, { depositOwnerId: 'sari' }),
      pay('d2', '2026-10-12', 200_000, { depositOwnerId: 'sari' }),
      pay('x', '2026-10-17', 320_000, { source: 'unbilled', statementId: UNB }),
    ])
    const l0 = await loadLedger(db, 'bca')
    // D-03 the 10 Oct deposit goes first: 300.000 on Grab; the 12 Oct one pays 20.000 of Grab and 100.000 of Apotek.
    expect(ownerDeposits(l0, 'bca', ['sari']).map((d) => d.payments.map((p) => [p.payment.id, p.used, p.left]))).toEqual([[['d1', 300_000, 0], ['d2', 120_000, 80_000]]])
    const { user } = renderAt('/payments', db)
    await user.click(await screen.findByRole('tab', { name: /^Deposits · 1$/ }))
    const sari = within(panel()).getByRole('region', { name: "Sari's deposit" })
    expect(within(sari).getByText('Rp 80.000')).toBeTruthy()
    expect(within(sari).getByText('16 Oct 2026 · GRAB')).toBeTruthy()
    expect(within(sari).getByText('− 320.000')).toBeTruthy()

    // Both of Sari's charges are fully paid by the deposits, so the 17 Oct line has nothing to pay: all of it is kept
    // as a third deposit (applied after the first two, by date; nothing is paid twice).
    await user.click(tab(/^To assign/))
    await user.click(within(panel()).getByRole('link', { name: 'Rp 320.000 17 Oct 2026' }))
    await user.click(await findWho('Sari'))
    expect(screen.getByLabelText('Hidden charges').textContent).toContain('0 charges made after 17 Oct 2026, 2 already fully paid')
    expect(screen.getByText('Nothing unpaid for Sari up to the payment date.')).toBeTruthy()
    await user.click(within(screen.getByRole('group', { name: 'Leftover' })).getByRole('button', { name: 'Sari' }))
    await user.click(save())
    await waitFor(() => expect(where()).toBe('/payments'))
    const l1 = await loadLedger(db, 'bca')
    const s1 = computeMoney(l1)
    expect([paidOf(s1, 'c1'), paidOf(s1, 'c2'), ownerDepositLeft(s1, 'sari')]).toEqual([320_000, 100_000, 400_000])
    await user.click(tab(/^Deposits/))
    const after = within(panel()).getByRole('region', { name: "Sari's deposit" })
    expect(within(after).getByText('Rp 400.000')).toBeTruthy()
    expect(within(after).getByText('17 Oct 2026 · kept 320.000')).toBeTruthy()
    expect(within(after).getByText('0 used · 320.000 left')).toBeTruthy()

    // D-05 a deposit with everything used shows "used, 0 left".
    await db.transactions.put(tx('c3', UNB, '2026-10-19', 'BIG', 400_000, 'sari'))
    expect(await within(panel()).findByText('used, 0 left')).toBeTruthy()
    expect(ownerBill(await loadLedger(db, 'bca'), 'sari', UNB, TODAY).depositWaiting).toBe(0)
  })
})

describe('Transactions → Payments', () => {
  it('F-02 / F-07 the Draft panel\'s payment issues open that payment', async () => {
    const db = await seedHousehold(freshNewDb(), householdWithHand())
    const { user } = renderAt('/transactions', db)
    await user.click(await screen.findByRole('button', { name: /^Statement:/ }))
    await user.click(within(screen.getByRole('listbox', { name: 'Statement' })).getByRole('option', { name: /Sep 2026 statement/ }))
    const draft = await screen.findByLabelText('Draft or Final')
    await user.click(within(draft).getByRole('link', { name: /Isn't on a statement: 5 Sep 2026/ }))
    expect(where()).toBe('/payments/hand-0905')
    expect(await screen.findByRole('region', { name: 'Assign payment' })).toBeTruthy()
  })
})

describe('view helpers', () => {
  it('typedRupiah reads typed amounts', () => {
    expect([typedRupiah('Rp 1.500.000'), typedRupiah(''), typedRupiah('abc'), typedRupiah('9'.repeat(20))]).toEqual([1_500_000, 0, 0, 0])
    // Not whole rupiah above 0: counts as 0 (Save stays disabled), never a misread amount.
    expect([typedRupiah('1.500.000,00'), typedRupiah('-500.000')]).toEqual([0, 0])
  })
})
