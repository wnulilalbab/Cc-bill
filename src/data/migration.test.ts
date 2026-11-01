import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { computeMoney, paidOf } from '../domain/amounts'
import { reconcileStatement } from '../domain/reconcile'
import type { BilledStatement, Ledger, Payment } from '../domain/types'
import expected from '../../test/fixtures/backup/old-backup.expected.json'
import { dumpIdb, fixture, freshNewDb, seedOldDb } from '../../test/data/oldDb'
import { readAll, loadLedger } from './repo'
import {
  applyMigration,
  lastVerification,
  migrate,
  MIGRATED_CARD,
  MIGRATED_UNBILLED_ID,
  planMigration,
  verifyMigration,
  type AdjustmentKind,
  type MigrationPlan,
} from './migration'
import { MigrationError, readOldData, type OldData } from './old'

const NOW = '2026-11-01T00:00:00.000Z'
const ids = (plan: MigrationPlan, kind: AdjustmentKind) => plan.adjustments.filter((a) => a.kind === kind).flatMap((a) => a.ids)
const ledgerOf = (plan: MigrationPlan): Ledger => ({ statements: plan.data.statements, transactions: plan.data.transactions, payments: plan.data.payments, plans: plan.data.plans })
const keluarga = (old: OldData) => old.owners.find((o) => o.name === 'Keluarga')!.id

describe('migration of the synthetic old-format backup', () => {
  it('G-01 migrates with counts and totals identical to the expected-result file, and the old DB is untouched', async () => {
    const oldName = await seedOldDb(fixture())
    const before = await dumpIdb(oldName)
    const db = freshNewDb()

    const old = (await readOldData(oldName))!
    const plan = planMigration(old, { defaultOwnerId: keluarga(old) })
    const v = await migrate(db, old, plan, NOW)

    expect(v.differences).toEqual([])
    expect(v.ok).toBe(true)
    const c = expected.counts
    expect(v.actual.counts).toEqual({
      owners: c.owners - 1, // "Unknown" is replaced by the card default
      statements: c.periods,
      transactions: c.transactions - 7, // 7 bank payment lines become payments
      bankPayments: 7,
      manualPayments: c.payments,
      plans: c.installmentPlans,
      allocations: c.paymentAllocations,
    })
    expect(v.actual.totals).toEqual({ charges: expected.totals.charges, credits: expected.totals.credits, manualPayments: 0, allocated: expected.totals.allocated })

    const data = await readAll(db)
    expect(data.transactions.length + data.payments.length).toBe(c.transactions)
    expect(data.cards).toEqual([{ id: MIGRATED_CARD.id, name: 'BCA Shared', bank: 'BCA', defaultOwnerId: keluarga(old) }])
    expect(new Set([...data.statements, ...data.transactions, ...data.payments, ...data.owners, ...data.plans].map((r) => r.cardId))).toEqual(new Set([MIGRATED_CARD.id]))
    // Every statement reconciles with the totals derived from its rows.
    const ledger = await loadLedger(db, MIGRATED_CARD.id)
    for (const s of ledger.statements.filter((x) => x.kind === 'billed')) expect(reconcileStatement(ledger, s.id).ok).toBe(true)

    expect(await dumpIdb(oldName)).toEqual(before)
    expect((await lastVerification(db))?.ok).toBe(true)
  })

  it('G-03 "Unknown" owner rows go to the card default owner and are marked Check', () => {
    const old = fixture()
    const unknown = old.owners.find((o) => o.name === 'Unknown')!.id
    const unknownTx = old.expenses.filter((e) => e.ownerId === unknown).map((e) => e.transactionId)
    expect(unknownTx).toHaveLength(expected.unknownOwnerExpenses)

    const plan = planMigration(old, { defaultOwnerId: keluarga(old) })
    expect(ids(plan, 'unknownOwner')).toEqual(unknownTx)
    for (const id of unknownTx) expect(plan.data.transactions.find((t) => t.id === id)).toMatchObject({ ownerId: keluarga(old), check: true })
    expect(plan.data.owners.map((o) => o.name)).not.toContain('Unknown')
    expect(plan.adjustments.find((a) => a.kind === 'unknownOwner')!.message).toBe('26 rows tagged "Unknown" go to the card default (Keluarga) and are marked Check.')

    // With the default "None", they stay without an owner, still with Check.
    const none = planMigration(old)
    for (const id of unknownTx) expect(none.data.transactions.find((t) => t.id === id)).toMatchObject({ ownerId: null, check: true })
    expect(none.data.cards[0].defaultOwnerId).toBeNull()
  })

  it('G-01 untagged rows (charges and the refund) get the default owner and Check', () => {
    const old = fixture()
    const plan = planMigration(old, { defaultOwnerId: keluarga(old) })
    const untagged = ids(plan, 'untagged').map((id) => plan.data.transactions.find((t) => t.id === id)!)
    expect(untagged.filter((t) => t.amount > 0)).toHaveLength(expected.unlabeledTransactions)
    expect(untagged.filter((t) => t.amount < 0).map((t) => t.kind)).toEqual(['refund'])
    for (const t of untagged) expect(t).toMatchObject({ ownerId: keluarga(old), check: true })
    expect(plan.data.transactions.filter((t) => t.check)).toHaveLength(untagged.length + expected.unknownOwnerExpenses)
  })

  it('G-01 statement payments keep their assignments, including the partial payment', () => {
    const old = fixture()
    const plan = planMigration(old, { defaultOwnerId: keluarga(old) })
    const bank = plan.data.payments
    expect(bank.map((p) => p.id)).toEqual(old.transactions.filter((t) => t.type === 'payment').map((t) => t.id))
    for (const p of bank) {
      expect(p.source).toBe('statement')
      const oldAllocs = old.paymentAllocations.filter((a) => a.paymentId === p.id)
      expect(p.allocations).toEqual(oldAllocs.map((a) => ({ txId: old.expenses.find((e) => e.id === a.expenseId)!.transactionId, amount: a.amount })))
    }
    // The old "partial" charge stays partly paid by exactly the same amount.
    const state = computeMoney(ledgerOf(plan))
    const partial = old.expenses.find((e) => e.status === 'partial')!
    const paidBefore = old.paymentAllocations.filter((a) => a.expenseId === partial.id).reduce((s, a) => s + a.amount, 0)
    const tx = plan.data.transactions.find((t) => t.id === partial.transactionId)!
    expect(paidOf(state, tx.id)).toBe(paidBefore)
    expect(paidBefore).toBeGreaterThan(0)
    expect(paidBefore).toBeLessThan(tx.amount)
    // Old statuses carry over as derived money.
    for (const e of old.expenses) {
      const t = plan.data.transactions.find((x) => x.id === e.transactionId)!
      const paid = paidOf(state, t.id)
      expect(e.status).toBe(paid >= t.amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid')
    }
    expect(plan.data.transactions.filter((t) => t.kind === 'installment').map((t) => [t.installment, t.planId])).toEqual([
      [{ n: 1, of: 12 }, 'plan-1'], [{ n: 2, of: 12 }, 'plan-1'], [{ n: 3, of: 12 }, 'plan-1'],
    ])
  })

  it('G-02 the preview lists every adjustment and planning writes nothing', async () => {
    const oldName = await seedOldDb(fixture())
    const before = await dumpIdb(oldName)
    const db = freshNewDb()
    const plan = planMigration((await readOldData(oldName))!)
    expect(plan.adjustments.map((a) => a.kind)).toEqual(['unknownOwnerRemoved', 'card', 'unknownOwner', 'untagged', 'statementPayments', 'statementDate', 'printedTotals', 'notKept'])
    expect(plan.adjustments.find((a) => a.kind === 'card')!.message).toBe('All 9 statements and their rows and payments go to card "BCA Shared".')
    expect(plan.adjustments.find((a) => a.kind === 'statementPayments')!.message).toBe('7 bank payment lines become payments and keep their 228 assignments.')
    // Cancel: nothing was written anywhere.
    expect(await Dexie.exists(db.name)).toBe(false)
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-05 running the migration again replaces the earlier migrated data cleanly (idempotent)', async () => {
    const old = fixture()
    const db = freshNewDb()
    await migrate(db, old, planMigration(old), NOW)
    const first = await readAll(db)
    // Something the user added on another card survives; an edit to migrated data is replaced.
    await db.cards.put({ id: 'card-other', name: 'Other', bank: 'X', defaultOwnerId: null })
    await db.transactions.update('tx-0001', { amount: 1 })
    await db.transactions.put({ ...first.transactions[0], id: 'tx-extra' }) // on the migrated card, not migrated

    const v = await migrate(db, old, planMigration(old), NOW)
    expect(v.ok).toBe(false) // the extra row on the migrated card is reported
    expect(v.differences).toEqual([{ check: 'count of transactions', expected: 292, actual: 293 }, { check: 'total of charges', expected: expected.totals.charges, actual: expected.totals.charges + first.transactions[0].amount }, { check: 'amount of tx-extra', expected: 'absent', actual: first.transactions[0].amount }])
    await db.transactions.delete('tx-extra')
    const again = await migrate(db, old, planMigration(old), NOW)
    expect(again.ok).toBe(true)
    const second = await readAll(db)
    expect({ ...second, cards: second.cards.filter((c) => c.id !== 'card-other') }).toEqual(first)
    expect(second.cards.map((c) => c.id)).toContain('card-other')
  })

  it('G-01 applyMigration writes in a single transaction: a failing write leaves nothing behind', async () => {
    const old = fixture()
    const db = freshNewDb()
    const plan = planMigration(old)
    const broken: MigrationPlan = { ...plan, data: { ...plan.data, payments: [...plan.data.payments, { id: undefined } as unknown as Payment] } }
    await expect(applyMigration(db, broken, NOW)).rejects.toThrow()
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [], rules: [] })
    expect(await db.meta.count()).toBe(0)
  })

  it.each([
    ['a plan of 0 months', (p: MigrationPlan) => (p.data.plans[0].total = 0), "An installment plan can't be stored in the new app: total must be a whole number of months. Nothing was written. (plan plan-1)"],
    ['a fractional amount', (p: MigrationPlan) => (p.data.transactions[0].amount = 10.5), "A transaction can't be stored in the new app: amount must be an integer number of rupiah, got 10.5. Nothing was written. (transaction tx-0001)"],
    ['a payment without allocations list', (p: MigrationPlan) => ((p.data.payments[0] as { allocations: unknown }).allocations = null), "A payment can't be stored in the new app: allocations must be a list. Nothing was written. (payment "],
  ])('G-01 applyMigration checks every planned record first: %s is refused and nothing is written', async (_name, damage, message) => {
    const db = freshNewDb()
    const plan = structuredClone(planMigration(fixture()))
    damage(plan)
    await expect(applyMigration(db, plan, NOW)).rejects.toThrow(message)
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [], rules: [] })
    expect(await db.meta.count()).toBe(0)
  })
})

describe('verification', () => {
  it('G-01 reports each mismatch precisely', () => {
    const old = fixture()
    const plan = planMigration(old)
    expect(verifyMigration(old, plan.data).ok).toBe(true)

    const data = structuredClone(plan.data)
    data.transactions.find((t) => t.id === 'tx-0001')!.amount += 100
    data.transactions = data.transactions.filter((t) => t.id !== 'tx-0002')
    const pay = data.payments.find((p) => p.id === 'tx-0046')!
    pay.allocations[0].amount -= 1
    data.owners.pop()
    const v = verifyMigration(old, data)
    expect(v.ok).toBe(false)
    expect(v.differences).toEqual([
      { check: 'count of owners', expected: 5, actual: 4 },
      { check: 'count of transactions', expected: 292, actual: 291 },
      { check: 'total of charges', expected: expected.totals.charges, actual: expected.totals.charges + 100 - 41300 },
      { check: 'total of allocated', expected: expected.totals.allocated, actual: expected.totals.allocated - 1 },
      { check: 'amount of tx-0001', expected: 21200, actual: 21300 },
      { check: 'amount of tx-0002', expected: 41300, actual: 'missing' },
      { check: 'assignment tx-0046 → tx-0001', expected: 21200, actual: 21199 },
    ])
  })

  it('G-01 reports a missing card and ignores records of other cards', () => {
    const old = fixture()
    const plan = planMigration(old)
    const data = structuredClone(plan.data)
    data.cards = [{ id: 'card-other', name: 'Other', bank: 'X', defaultOwnerId: null }]
    data.transactions.push({ ...data.transactions[0], id: 'other-tx', cardId: 'card-other' })
    expect(verifyMigration(old, data).differences).toEqual([{ check: 'card "BCA Shared"', expected: 'present', actual: 'missing' }])
  })
})

/** A small synthetic old database with every irregularity the migration handles. */
function messy(): OldData {
  const tx = (id: string, periodId: string, date: string, amount: number, type: string, extra = {}) =>
    ({ id, periodId, date, description: `ROW ${id.toUpperCase()}`, amount, type, hidden: false, ...extra }) as OldData['transactions'][number]
  return {
    owners: [{ id: 'o-unk', name: ' unknown ', color: 'red' }, { id: 'o-a', name: 'Andi', color: 'blue' }, { id: 'o-s', name: 'Sari', color: 'pink' }],
    periods: [
      { id: 'p2', label: 'Aug 2026', month: 8, year: 2026, dueDate: '2026-08-28', importedAt: NOW, type: 'billed' },
      { id: 'p1', label: 'Jul 2026', month: 7, year: 2026, importedAt: NOW }, // v1 period: no type, no due date
      { id: 'p3', label: 'Sep 2026', month: 9, year: 2026, importedAt: NOW, type: 'billed' }, // empty
      { id: 'unbilled-pool', label: 'Unbilled', month: 0, year: 0, importedAt: NOW },
      { id: 'u2', label: 'Unbilled', month: 0, year: 0, importedAt: NOW, type: 'unbilled' },
    ],
    transactions: [
      tx('t1', 'p1', '2026-07-02', 100000, 'purchase'),
      tx('t2', 'p1', '2026-07-03', 50000, 'purchase'),
      tx('t3', 'p1', '2026-07-04', 30000, 'purchase'),
      tx('t4', 'p1', '2026-07-05', 15000, 'fee'),
      tx('t5', 'p1', '2026-07-06', -20000, 'purchase'),
      tx('t6', 'p1', '2026-07-01', 5000, 'refund'),
      tx('t7', 'p2', '2026-08-02', 400000, 'purchase', { hidden: true }),
      tx('t8', 'p2', '2026-08-03', -400000, 'reversal', { hidden: true }),
      tx('t9', 'p2', '2026-08-04', 120000, 'installment'),
      { ...tx('t10', 'p2', '2026-08-05', 120000, 'installment'), description: 'CICILAN BCA KE 02 DARI 06, SHOP' },
      tx('t11', 'p2', '2026-08-06', -100000, 'payment'),
      tx('t12', 'unbilled-pool', '2026-09-02', 70000, 'purchase', { source: 'screenshot' }),
      tx('t13', 'u2', '2026-09-03', -50000, 'payment'),
      tx('t14', 'p2', '2026-08-07', -10000, 'refund'),
      tx('t15', 'p2', '2026-08-08', 2000, 'interest'),
      tx('t16', 'p2', '2026-08-09', -3000, 'reversal', { hidden: true }), // hidden reversal without its pair
      tx('t17', 'p1', '2026-07-07', 120000, 'installment'), // before the plan's start month: no number
    ],
    expenses: [
      { id: 'e1', transactionId: 't1', label: 'A', ownerId: 'o-a', status: 'paid' },
      { id: 'e2', transactionId: 't2', label: 'B', ownerId: 'o-unk', status: 'unpaid' },
      { id: 'e6', transactionId: 't6', label: 'C', ownerId: 'o-s', status: 'unpaid' },
      { id: 'e7', transactionId: 't7', label: 'D', ownerId: 'o-a', status: 'unpaid' },
      { id: 'e9', transactionId: 't9', label: 'E', ownerId: 'o-a', installmentPlanId: 'pl1', status: 'paid' },
      { id: 'e10', transactionId: 't10', label: 'F', ownerId: 'o-gone', installmentPlanId: 'pl-gone', status: 'unpaid' },
      { id: 'e12', transactionId: 't12', label: 'G', ownerId: 'o-s', status: 'paid' },
      { id: 'e15', transactionId: 't15', label: 'H', ownerId: 'o-a', status: 'unpaid' },
      { id: 'e17', transactionId: 't17', label: 'I', ownerId: 'o-a', installmentPlanId: 'pl1', status: 'unpaid' },
      { id: 'eX', transactionId: 't1', label: 'dup', ownerId: 'o-s', status: 'paid' },
      { id: 'eY', transactionId: 't-missing', label: 'gone', ownerId: 'o-a', status: 'paid' },
      { id: 'eZ', transactionId: 't11', label: 'pay', ownerId: 'o-a', status: 'paid' },
    ],
    installmentPlans: [
      { id: 'pl1', name: 'Plan', originalAmount: 720000, totalMonths: 6, monthlyAmount: 120000, startPeriod: '2026-08', ownerId: 'o-unk', notes: 'x' },
      { id: 'pl2', name: 'Plan 2', originalAmount: 100, totalMonths: 1, monthlyAmount: 100, startPeriod: '2026-07', ownerId: 'o-a' },
    ],
    payments: [
      { id: 'm1', periodId: 'p2', date: '2026-08-20', amount: 200000, note: 'transfer' },
      { id: 'm2', periodId: 'p2', date: '2026-08-21', amount: 1000, note: '' },
    ],
    paymentAllocations: [
      { id: 'a1', paymentId: 't11', expenseId: 'e1', amount: 60000 },
      { id: 'a2', paymentId: 't11', expenseId: 'eX', amount: 40000 },
      { id: 'a3', paymentId: 't13', expenseId: 'e12', amount: 70000 },
      { id: 'a4', paymentId: 't14', expenseId: 'e2', amount: 10000 },
      { id: 'a5', paymentId: 'm1', expenseId: 'e9', amount: 120000 },
      { id: 'a6', paymentId: 'nope', expenseId: 'e1', amount: 1 },
      { id: 'a7', paymentId: 't11', expenseId: 'eY', amount: 5 },
      { id: 'a8', paymentId: 't11', expenseId: 'eZ', amount: 7 },
    ],
  }
}

describe('migration adjustments', () => {
  const old = messy()
  const plan = planMigration(old, { defaultOwnerId: 'o-s' })
  const row = (id: string) => plan.data.transactions.find((t) => t.id === id)!
  const payment = (id: string) => plan.data.payments.find((p) => p.id === id)!

  it('G-02 lists every adjustment with the old records it touches', () => {
    expect(plan.adjustments).toEqual([
      { kind: 'unknownOwnerRemoved', message: 'The owner "Unknown" is not carried over; its rows go to the card default (Sari).', ids: ['o-unk'] },
      { kind: 'card', message: 'All 3 statements and their rows and payments go to card "BCA Shared".', ids: ['p1', 'p2', 'p3'] },
      { kind: 'unbilledMerged', message: '2 Unbilled lists in the old data; the card gets one Unbilled list.', ids: ['unbilled-pool', 'u2'] },
      { kind: 'droppedTags', message: '3 tags not carried over: the row is missing, is a payment, or already has a tag.', ids: ['eX', 'eY', 'eZ'] },
      { kind: 'unknownOwner', message: '1 row tagged "Unknown" go to the card default (Sari) and are marked Check.', ids: ['t2'] },
      { kind: 'missingOwner', message: '1 row tagged with an owner that no longer exists go to the card default (Sari) and are marked Check.', ids: ['t10'] },
      { kind: 'untagged', message: '5 rows without an owner go to the card default (Sari) and are marked Check.', ids: ['t3', 't5', 't8', 't14', 't16'] },
      { kind: 'feeOwner', message: '1 fee or interest row without an owner go to the card default (Sari).', ids: ['t4'] },
      { kind: 'signFixed', message: '2 rows had a type that did not match the sign of the amount; the type now follows the amount and the row is marked Check.', ids: ['t5', 't6'] },
      { kind: 'hidden', message: '3 hidden rows (reversal pairs) are kept as cancelled rows and reversals, which count 0.', ids: ['t7', 't8', 't16'] },
      { kind: 'installmentNumber', message: "1 installment row got their number (n of N) from the plan's start month.", ids: ['t9'] },
      { kind: 'statementPayments', message: '2 bank payment lines become payments and keep their 3 assignments.', ids: ['t11', 't13'] },
      { kind: 'manualPayments', message: '2 hand-recorded payments are kept with their 1 assignment.', ids: ['m1', 'm2'] },
      { kind: 'leftToAssign', message: `2 payments have money left to assign (Rp ${(81000).toLocaleString('id-ID')} in all); it stays "Decide later".`, ids: ['m1', 'm2'] },
      { kind: 'overAssigned', message: '1 payment were assigned more than their amount; reopen them to fix the assignments.', ids: ['t13'] },
      { kind: 'mergedAssignments', message: '1 assignment to a row that the same payment already covered are combined with it.', ids: [] },
      {
        kind: 'droppedAssignments',
        message: '4 assignments not carried over: made from a refund or reversal, which now reduces the charges by itself; its payment (nope) no longer exists; its tagged row (eY) no longer exists; its tagged row (eZ) no longer exists.',
        ids: ['a4', 'a6', 'a7', 'a8'],
      },
      { kind: 'statementDate', message: '3 statements get the date of their last row as statement date.', ids: ['p1', 'p2', 'p3'] },
      { kind: 'dueDate', message: '2 statements had no due date; it is set to 15 days after the statement date.', ids: ['p1', 'p3'] },
      { kind: 'printedTotals', message: 'The old app did not store the printed statement totals; they are computed from the rows, so every statement reconciles.', ids: ['p1', 'p2', 'p3'] },
      { kind: 'missingOwner', message: '1 installment plan with an "Unknown" or missing owner go to the card default (Sari).', ids: ['pl1'] },
      { kind: 'notKept', message: "Not stored in the new app: owner colours (colours now come from the card palette); tag labels and paid status (status is recomputed from the payments); installment plans' original price and notes. They stay in the old data and its JSON backup.", ids: [] },
    ])
  })

  it('G-01 maps rows, hidden pairs, installments and statements', () => {
    expect(row('t1')).toEqual({ id: 't1', cardId: MIGRATED_CARD.id, statementId: 'p1', date: '2026-07-02', description: 'ROW T1', amount: 100000, kind: 'purchase', ownerId: 'o-a' })
    expect(row('t5')).toMatchObject({ kind: 'refund', amount: -20000, check: true })
    expect(row('t6')).toMatchObject({ kind: 'purchase', amount: 5000, ownerId: 'o-s', check: true })
    expect(row('t7')).toMatchObject({ cancelled: true, ownerId: 'o-a' })
    expect(row('t8')).toMatchObject({ kind: 'reversal', reverses: 't7' })
    expect(row('t16').reverses).toBeUndefined()
    expect(row('t9')).toMatchObject({ planId: 'pl1', installment: { n: 1, of: 6 } })
    expect(row('t10')).toMatchObject({ installment: { n: 2, of: 6 }, ownerId: 'o-s', check: true })
    expect(row('t10').planId).toBeUndefined()
    expect(row('t17').installment).toBeUndefined()
    expect(row('t12').statementId).toBe(MIGRATED_UNBILLED_ID)
    expect(row('t15')).toMatchObject({ kind: 'interest', ownerId: 'o-a' })
    expect(row('t15').check).toBeUndefined()

    const st = (id: string) => plan.data.statements.find((s) => s.id === id) as BilledStatement
    expect(plan.data.statements.map((s) => s.id)).toEqual(['p1', 'p2', 'p3', MIGRATED_UNBILLED_ID])
    expect(st('p1')).toMatchObject({ statementDate: '2026-07-07', dueDate: '2026-07-22', printed: { prevBalance: 0, purchases: 305000, credits: 20000, feesInterest: 15000, newBalance: 300000 } })
    expect(st('p2')).toMatchObject({ statementDate: '2026-08-09', dueDate: '2026-08-28', printed: { prevBalance: 300000 } })
    expect(st('p3')).toMatchObject({ statementDate: '2026-09-01', dueDate: '2026-09-16' })
    const ledger = ledgerOf(plan)
    for (const id of ['p1', 'p2', 'p3']) expect(reconcileStatement(ledger, id).ok).toBe(true)

    expect(plan.data.plans).toEqual([
      { id: 'pl1', cardId: MIGRATED_CARD.id, ownerId: 'o-s', name: 'Plan', monthly: 120000, total: 6, start: '2026-08' },
      { id: 'pl2', cardId: MIGRATED_CARD.id, ownerId: 'o-a', name: 'Plan 2', monthly: 100, total: 1, start: '2026-07' },
    ])
  })

  it('G-01 maps payments with merged assignments and keeps hand-recorded ones', () => {
    expect(payment('t11')).toEqual({ id: 't11', cardId: MIGRATED_CARD.id, source: 'statement', date: '2026-08-06', amount: 100000, statementId: 'p2', allocations: [{ txId: 't1', amount: 100000 }], description: 'ROW T11' })
    expect(payment('t13')).toMatchObject({ source: 'unbilled', statementId: MIGRATED_UNBILLED_ID, amount: 50000, allocations: [{ txId: 't12', amount: 70000 }] })
    expect(payment('m1')).toEqual({ id: 'm1', cardId: MIGRATED_CARD.id, source: 'manual', date: '2026-08-20', amount: 200000, allocations: [{ txId: 't9', amount: 120000 }], description: 'transfer' })
    expect(payment('m2')).toEqual({ id: 'm2', cardId: MIGRATED_CARD.id, source: 'manual', date: '2026-08-21', amount: 1000, allocations: [] })
  })

  it('G-01 verifies the irregular data too, counting only the assignments that carry over', () => {
    const v = verifyMigration(old, plan.data)
    expect(v.differences).toEqual([])
    expect(v.expected.counts).toMatchObject({ owners: 2, statements: 4, transactions: 15, bankPayments: 2, manualPayments: 2, allocations: 3 })
    expect(v.expected.totals).toEqual({ charges: 100000 + 50000 + 30000 + 15000 + 5000 + 400000 + 120000 + 120000 + 70000 + 2000 + 120000, credits: 20000 + 400000 + 100000 + 50000 + 10000 + 3000, manualPayments: 201000, allocated: 290000 })
  })

  it('G-01 uses the card statement day when given, clamped to the month', () => {
    const p = planMigration({ ...old, periods: [...old.periods, { id: 'p4', label: 'Feb 2027', month: 2, year: 2027, importedAt: NOW, type: 'billed' }] }, { statementDay: 31 })
    expect(p.data.cards[0].statementDay).toBe(31)
    expect((p.data.statements.find((s) => s.id === 'p1') as BilledStatement).statementDate).toBe('2026-07-31')
    expect((p.data.statements.find((s) => s.id === 'p4') as BilledStatement).statementDate).toBe('2027-02-28')
    expect(p.adjustments.map((a) => a.kind)).not.toContain('statementDate')
  })

  it('G-01 with default owner None: fees are marked Check; with one Unbilled list nothing is merged', () => {
    const p = planMigration({ ...old, periods: old.periods.filter((x) => x.id !== 'u2'), transactions: old.transactions.filter((t) => t.periodId !== 'u2') })
    expect(p.data.transactions.find((t) => t.id === 't4')).toMatchObject({ ownerId: null, check: true })
    expect(p.adjustments.find((a) => a.kind === 'feeOwner')!.message).toBe('1 fee or interest row without an owner go to the card default (None) and are marked Check.')
    expect(p.adjustments.map((a) => a.kind)).not.toContain('unbilledMerged')
  })

  it('G-02 an empty description does not stop the migration: the row is kept and listed in the preview', () => {
    const data = messy()
    data.transactions.find((t) => t.id === 't3')!.description = ''
    data.transactions.find((t) => t.id === 't11')!.description = '   '
    const p = planMigration(data)
    expect(p.adjustments.find((a) => a.kind === 'emptyDescription')).toEqual({ kind: 'emptyDescription', message: '2 rows with an empty description are kept as they are.', ids: ['t3', 't11'] })
    expect(p.data.transactions.find((t) => t.id === 't3')).toMatchObject({ description: '', amount: 30000 })
    expect(verifyMigration(data, p.data).ok).toBe(true)
    expect(plan.adjustments.map((a) => a.kind)).not.toContain('emptyDescription')
  })

  it('G-03 options: default owner and statement day are optional; without them Unknown rows are unowned + Check', () => {
    const p = planMigration(old)
    expect(p.data.cards[0]).toEqual({ id: MIGRATED_CARD.id, name: 'BCA Shared', bank: 'BCA', defaultOwnerId: null })
    expect(p.data.transactions.find((t) => t.id === 't2')).toMatchObject({ ownerId: null, check: true })
    expect(p.adjustments.find((a) => a.kind === 'unknownOwner')!.message).toContain('card default (None)')
    const q = planMigration(old, { defaultOwnerId: 'o-a', statementDay: 12 })
    expect(q.data.cards[0]).toMatchObject({ defaultOwnerId: 'o-a', statementDay: 12 })
    expect(q.data.transactions.find((t) => t.id === 't2')).toMatchObject({ ownerId: 'o-a', check: true })
    expect((q.data.statements.find((s) => s.id === 'p2') as BilledStatement).statementDate).toBe('2026-08-12')
  })

  it('G-01 empty old data plans just the card and its Unbilled list', () => {
    const empty: OldData = { owners: [], periods: [], transactions: [], expenses: [], installmentPlans: [], payments: [], paymentAllocations: [] }
    const p = planMigration(empty)
    expect(p.data.statements).toEqual([{ id: MIGRATED_UNBILLED_ID, cardId: MIGRATED_CARD.id, kind: 'unbilled' }])
    expect(p.adjustments.map((a) => a.kind)).toEqual(['card', 'unbilledMerged'])
    expect(verifyMigration(empty, p.data).ok).toBe(true)
  })

  it('G-01 rejects bad options and impossible statement months with a clear error', () => {
    expect(() => planMigration(old, { defaultOwnerId: 'o-unk' })).toThrow(MigrationError)
    expect(() => planMigration(old, { defaultOwnerId: 'nobody' })).toThrow('The default owner must be one of the old owners (other than "Unknown"), got "nobody".')
    expect(() => planMigration(old, { statementDay: 0 })).toThrow('The statement day must be 1–31, got 0.')
    expect(() => planMigration(old, { statementDay: 2.5 })).toThrow(MigrationError)
    const bad = { ...old, periods: [{ id: 'px', label: 'X', month: 13, year: 2026, importedAt: NOW, type: 'billed' as const }], transactions: [] }
    expect(() => planMigration(bad)).toThrow('A statement has month 13; it must be 1–12 (statement px).')
  })
})
