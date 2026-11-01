import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { computeMoney, depositLeftOf, ownerDepositLeft, paidOf, txStatus, unassignedOf } from '../domain/amounts'
import { ownerBill } from '../domain/bill'
import { draftIssues } from '../domain/draft'
import { paymentTab } from '../domain/payments'
import { freshNewDb } from '../../test/data/oldDb'
import { OCT, pay, seedCards, seedPaidRows, tx, UNB } from '../../test/transactions/ledger'
import { loadLedger } from './repo'
import { setOwner } from './rules'
import {
  addRow,
  bulkSetOwner,
  convertRow,
  deleteRow,
  keepWaitingOn,
  markReviewed,
  previewBulkOwner,
  previewConversion,
  RowError,
  updateRow,
} from './transactions'

const TODAY = '2026-10-25'

async function money(db: ReturnType<typeof freshNewDb>) {
  const ledger = await loadLedger(db, 'bca')
  const state = computeMoney(ledger)
  const p = (id: string) => ledger.payments.find((x) => x.id === id)!
  const t = (id: string) => ledger.transactions.find((x) => x.id === id)!
  return {
    ledger,
    state,
    bill: (owner: string) => ownerBill(ledger, owner, OCT.id, TODAY, state),
    deposit: (owner: string) => ownerDepositLeft(state, owner),
    p,
    t,
    status: (id: string) => txStatus(state, t(id)),
  }
}

describe('owner change on a paid row (data, X-05 / X-06)', () => {
  it('X-05 Keep payment: the assignment stays; the payer’s money keeps paying the charge for its new owner', async () => {
    const db = await seedPaidRows(freshNewDb())
    const before = await money(db)
    expect(before.bill('andi')).toMatchObject({ charges: 300_000, alreadyPaid: 300_000, mustPay: 0, depositWaiting: 50_000 })
    expect(before.bill('sari')).toMatchObject({ charges: 120_000, alreadyPaid: 120_000, mustPay: 0 })
    expect(paidOf(before.state, 't-later')).toBe(150_000)

    await setOwner(db, 't-ikea', 'sari', { payments: 'keep' })
    const after = await money(db)
    expect(after.p('p-andi')).toEqual(before.p('p-andi'))
    expect(after.t('t-ikea')).toMatchObject({ ownerId: 'sari', tagSource: 'manual' })
    expect(after.status('t-ikea')).toBe('paid')
    expect(after.bill('sari')).toMatchObject({ charges: 420_000, alreadyPaid: 420_000, mustPay: 0 })
    expect(after.bill('andi')).toMatchObject({ charges: 0, alreadyPaid: 0, mustPay: 0, depositWaiting: 50_000 })
    expect(unassignedOf(after.p('p-andi'))).toBe(200_000)
    expect(paidOf(after.state, 't-later')).toBe(150_000)
  })

  it('X-06 Unassign: the assignment is removed, the charge is unpaid for its new owner, and the money goes back to the payer’s deposit', async () => {
    const db = await seedPaidRows(freshNewDb())
    await setOwner(db, 't-ikea', 'sari', { payments: 'unassign' })
    const after = await money(db)
    expect(after.p('p-andi').allocations).toEqual([])
    expect(after.status('t-ikea')).toBe('unpaid')
    expect(after.bill('sari')).toMatchObject({ charges: 420_000, alreadyPaid: 120_000, thisRemaining: 300_000, mustPay: 300_000 })
    expect(after.bill('andi')).toMatchObject({ charges: 0, mustPay: 0 })
    // The whole 500.000 is Andi's deposit again: it still pays Andi's 150.000 Unbilled charge, 350.000 waiting.
    expect(unassignedOf(after.p('p-andi'))).toBe(500_000)
    expect(depositLeftOf(after.state, after.p('p-andi'))).toBe(350_000)
    expect(after.deposit('andi')).toBe(350_000)
    expect(paidOf(after.state, 't-later')).toBe(150_000)
  })

  it('X-06 Unassign on a payment without a deposit: back to "To assign", and it blocks the Oct bill again', async () => {
    const db = await seedPaidRows(freshNewDb())
    const before = await money(db)
    expect(paymentTab(before.ledger, before.p('p-sari'))).toBe('done')
    expect(draftIssues(before.ledger, OCT.id).blockingPayments).toEqual([])

    await setOwner(db, 't-books', 'andi', { payments: 'unassign' })
    const after = await money(db)
    expect(unassignedOf(after.p('p-sari'))).toBe(120_000)
    expect(paymentTab(after.ledger, after.p('p-sari'))).toBe('toAssign')
    expect(draftIssues(after.ledger, OCT.id).blockingPayments).toEqual(['p-sari'])
    expect(after.bill('andi')).toMatchObject({ charges: 420_000, alreadyPaid: 300_000, mustPay: 120_000 })
    expect(after.bill('sari')).toMatchObject({ charges: 0, mustPay: 0 })
  })
})

describe('row edits (data)', () => {
  it('X-04 delete with a payment: the row goes, the payment amount is back to To assign (or the deposit)', async () => {
    const db = await seedPaidRows(freshNewDb())
    expect(await deleteRow(db, 't-books')).toBe(1)
    expect(await deleteRow(db, 't-later')).toBe(0)
    const after = await money(db)
    expect(after.ledger.transactions.map((t) => t.id)).toEqual(['t-ikea'])
    expect(unassignedOf(after.p('p-sari'))).toBe(120_000)
    expect(paymentTab(after.ledger, after.p('p-sari'))).toBe('toAssign')
    expect(after.deposit('andi')).toBe(200_000) // the Unbilled charge it paid is gone
    await expect(deleteRow(db, 't-books')).rejects.toThrow('This transaction no longer exists.')
  })

  it('X-02 fix amount, date, description and label; amount cannot drop below what payments cover', async () => {
    const db = await seedPaidRows(freshNewDb())
    expect(await updateRow(db, 't-later', { amount: 175_000, date: '2026-10-21', description: '  GRAB*  A-7XK2 ', label: ' Taxi ' })).toMatchObject({
      amount: 175_000,
      date: '2026-10-21',
      description: 'GRAB* A-7XK2',
      label: 'Taxi',
    })
    expect((await updateRow(db, 't-later', { label: '' })).label).toBeUndefined()
    await expect(updateRow(db, 't-ikea', { amount: 250_000 })).rejects.toThrow('Payments cover Rp 300.000 of this row.')
    await expect(updateRow(db, 't-ikea', { amount: 1.5 })).rejects.toThrow('Enter the amount in whole rupiah.')
    await expect(updateRow(db, 't-ikea', { date: '3 Oct' })).rejects.toThrow('Pick a date.')
    await expect(updateRow(db, 't-ikea', { description: '  ' })).rejects.toThrow('The description cannot be empty.')
    await expect(updateRow(db, 'gone', {})).rejects.toBeInstanceOf(RowError)
  })

  it('X-03 add a missing row: on the chosen statement, source You, description upper-cased; bad input refused', async () => {
    const db = await seedCards(freshNewDb())
    const t = await addRow(db, { statementId: OCT.id, date: '2026-10-07', description: ' kopi  kenangan ', amount: 45_000, kind: 'purchase', ownerId: 'sari', label: 'Coffee' })
    expect(t).toMatchObject({ cardId: 'bca', statementId: OCT.id, description: 'KOPI KENANGAN', amount: 45_000, ownerId: 'sari', tagSource: 'manual', label: 'Coffee' })
    expect(t.check).toBeUndefined()
    const base = { statementId: OCT.id, date: '2026-10-07', description: 'X', amount: 1, kind: 'purchase' as const, ownerId: null }
    await expect(addRow(db, { ...base, statementId: 'nope' })).rejects.toThrow('This statement no longer exists.')
    await expect(addRow(db, { ...base, description: ' ' })).rejects.toThrow('Add a description.')
    await expect(addRow(db, { ...base, amount: 0 })).rejects.toThrow('Enter the amount in whole rupiah.')
    await expect(addRow(db, { ...base, date: '' })).rejects.toThrow('Pick a date.')
    await expect(addRow(db, { ...base, ownerId: 'mdr-andi' })).rejects.toThrow('Pick an owner of this card.')
    await expect(addRow(db, { ...base, ownerId: 'bima' })).rejects.toThrow('Bima is archived. Pick another owner.')
    expect(await addRow(db, { ...base, ownerId: null })).toMatchObject({ ownerId: null })
  })

  it('mark reviewed: Check cleared, source You (history learns from it), owner kept; already reviewed rows untouched', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.bulkPut([
      tx('a', OCT.id, '2026-10-01', 'SHOPEE 1', 9000, 'andi', { check: true, tagSource: 'ai' }),
      tx('b', OCT.id, '2026-10-01', 'GRAB 1', 9000, 'sari', { tagSource: 'rule' }),
      tx('c', OCT.id, '2026-10-01', 'KCI', 9000, 'sari', { tagSource: 'manual' }),
    ])
    expect(await markReviewed(db, ['a', 'b', 'c', 'gone'])).toBe(2)
    expect(await db.transactions.get('a')).toEqual(tx('a', OCT.id, '2026-10-01', 'SHOPEE 1', 9000, 'andi', { tagSource: 'manual' }))
    expect(await db.transactions.get('b')).toMatchObject({ ownerId: 'sari', tagSource: 'manual' })
  })

  it('bulk set owner: paid rows skipped, rows set by hand only when chosen, unchanged rows counted', async () => {
    const db = await seedPaidRows(freshNewDb())
    await db.transactions.bulkPut([
      tx('n1', UNB, '2026-10-21', 'NETFLIX', 54_000, 'andi', { check: true, tagSource: 'default' }),
      tx('n2', UNB, '2026-10-21', 'SPOTIFY', 55_000, null),
      tx('n3', UNB, '2026-10-22', 'HALODOC', 80_000, 'andi', { tagSource: 'manual' }),
      tx('n4', UNB, '2026-10-22', 'KCI', 3_000, 'sari', { tagSource: 'manual' }),
      tx('n5', UNB, '2026-10-22', 'KFC', 30_000, 'sari', { check: true }),
    ])
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5', 't-ikea', 't-books']
    const preview = await previewBulkOwner(db, ids, 'sari')
    expect(preview.change.map((t) => t.id)).toEqual(['n1', 'n2', 'n5'])
    expect(preview.manual.map((t) => t.id)).toEqual(['n3'])
    expect(preview).toMatchObject({ paid: 1, unchanged: 2 }) // t-ikea paid; n4 and t-books already Sari's

    expect(await bulkSetOwner(db, ids, 'sari')).toEqual({ changed: 3, paidSkipped: 1, manualSkipped: 1 })
    expect(await db.transactions.get('n1')).toMatchObject({ ownerId: 'sari', tagSource: 'manual' })
    expect((await db.transactions.get('n1'))?.check).toBeUndefined()
    expect((await db.transactions.get('n3'))?.ownerId).toBe('andi')
    expect((await db.transactions.get('t-ikea'))?.ownerId).toBe('andi')
    expect(await bulkSetOwner(db, ['n3'], 'sari', { includeManual: true })).toEqual({ changed: 1, paidSkipped: 0, manualSkipped: 0 })
    expect((await db.transactions.get('n3'))?.ownerId).toBe('sari')
    await expect(bulkSetOwner(db, ['n3'], 'bima')).rejects.toThrow('Bima is archived.')
    await expect(bulkSetOwner(db, ['n3'], 'mdr-andi')).rejects.toThrow('Pick an owner of this card.')
  })

  it('keep waiting on an Unbilled row the statement did not contain', async () => {
    const db = await seedCards(freshNewDb())
    await db.transactions.put(tx('u1', UNB, '2026-10-01', 'TOKO', 9000, 'andi'))
    expect(draftIssues(await loadLedger(db, 'bca'), OCT.id).notOnStatementRows).toEqual(['u1'])
    await keepWaitingOn(db, 'u1')
    expect(draftIssues(await loadLedger(db, 'bca'), OCT.id).notOnStatementRows).toEqual([])
  })
})

describe('installment conversion (data)', () => {
  async function seedConversion() {
    const db = await seedCards(freshNewDb())
    await db.transactions.bulkPut([
      tx('orig', 'bca-sep', '2026-09-03', 'BLIBLI.COM *121 JAKARTA', 1_200_000, 'sari'),
      tx('rev', OCT.id, '2026-09-20', 'REVERSAL CICILAN BCA BLIBLI.COM *121', -1_200_000, null, { kind: 'reversal' }),
      tx('inst', OCT.id, '2026-09-20', 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM', 200_000, null, { kind: 'installment', installment: { n: 1, of: 6 } }),
    ])
    await db.payments.put(pay('p1', '2026-09-25', 500_000, { allocations: [{ txId: 'orig', amount: 500_000 }] }))
    return db
  }

  it('I-07 convert: original and reversal not counted, payment moved to 1/N, excess to the owner’s deposit, plan created', async () => {
    const db = await seedConversion()
    const preview = await previewConversion(db, 'rev')
    expect('error' in preview).toBe(false)
    expect(await db.plans.count()).toBe(0) // preview writes nothing

    const r = await convertRow(db, 'rev')
    expect(r.conflicts).toEqual([])
    const m = await money(db)
    expect(m.t('orig').cancelled).toBe(true)
    expect(m.t('rev')).toMatchObject({ reverses: 'orig', ownerId: 'sari' })
    expect(m.t('inst')).toMatchObject({ ownerId: 'sari', planId: r.plan.id })
    expect(m.p('p1')).toMatchObject({ allocations: [{ txId: 'inst', amount: 200_000 }], depositOwnerId: 'sari' })
    expect(m.status('orig')).toBe('notCounted')
    expect(m.status('inst')).toBe('paid')
    expect(await db.plans.get(r.plan.id)).toMatchObject({ ownerId: 'sari', monthly: 200_000, total: 6, start: '2026-10' })
  })

  it('convert errors are readable: not a reversal line, original missing', async () => {
    const db = await seedConversion()
    await expect(convertRow(db, 'inst')).rejects.toThrow('Only a "REVERSAL CICILAN … *ref" line can be converted.')
    await db.transactions.delete('orig')
    expect(await previewConversion(db, 'rev')).toEqual({ error: 'originalNotFound' })
    await expect(convertRow(db, 'rev')).rejects.toThrow('The original purchase')
  })
})
