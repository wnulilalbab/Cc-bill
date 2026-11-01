import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { fillOldestFirst, type AssignDraft } from '../domain/allocate'
import { computeMoney, countedPayments, ownerDepositLeft, paidOf } from '../domain/amounts'
import { ownerBill } from '../domain/bill'
import { MoneyError } from '../domain/money'
import { bankStatus } from '../domain/payments'
import { freshNewDb } from '../../test/data/oldDb'
import { handPayments, IDS, seedHousehold, TODAY } from '../../test/payments/household'
import { OCT, pay, seedCards, tx, UNB } from '../../test/transactions/ledger'
import { friendlyMoneyError, keepPaymentWaiting, LINKED_LINE, movePayment, newPaymentId, PaymentError, removePayment, saveAssign } from './payments'
import { loadLedger } from './repo'

const draft = (d: Partial<AssignDraft>): AssignDraft => ({ cardId: 'bca', date: '2026-10-15', amount: 100_000, ownerIds: ['andi'], multi: false, allocations: {}, ...d })

async function smallDb() {
  const db = await seedCards(freshNewDb())
  await db.transactions.bulkPut([tx('t1', OCT.id, '2026-10-03', 'IKEA', 300_000, 'andi'), tx('t2', UNB, '2026-10-20', 'GRAB', 50_000, 'andi')])
  return db
}

describe('saveAssign', () => {
  it('P-18 a new hand payment is saved with its assignments; the leftover becomes the chosen deposit (D-01)', async () => {
    const db = await smallDb()
    const r = await saveAssign(db, draft({ amount: 400_000, allocations: { t1: 300_000 } }), 'andi', { description: '  Transfer from Andi ' })
    expect(r.linkedTo).toBeUndefined()
    expect(r.payment).toMatchObject({ source: 'manual', amount: 400_000, date: '2026-10-15', allocations: [{ txId: 't1', amount: 300_000 }], depositOwnerId: 'andi', forOwnerIds: ['andi'], description: 'Transfer from Andi' })
    const ledger = await loadLedger(db, 'bca')
    const state = computeMoney(ledger)
    // The 100.000 deposit (15 Oct) pays the 20 Oct Grab; 50.000 waits.
    expect(paidOf(state, 't2')).toBe(50_000)
    expect(ownerDepositLeft(state, 'andi')).toBe(50_000)

    // Edit it: "Decide later" drops the deposit; the amount can change (hand-recorded, not matched).
    const again = await saveAssign(db, { ...draft({ amount: 350_000, allocations: { t1: 300_000 } }), paymentId: r.payment.id }, null)
    expect(again.payment).not.toHaveProperty('depositOwnerId')
    expect(again.payment.amount).toBe(350_000)
    expect(again.payment.description).toBe('Transfer from Andi')
  })

  it('P-13 the household\'s 18 Oct 2.000.000 is matched to the 20 Oct bank line and counted once; assignments kept', async () => {
    const db = await seedHousehold(freshNewDb())
    const r = await saveAssign(db, { cardId: 'bca', date: '2026-10-18', amount: 2_000_000, ownerIds: ['Andi'], multi: false, allocations: {} }, null)
    expect(r.linkedTo?.id).toBe(IDS.OCT20_LINE)
    expect(r.payment.linkedStatementLine).toBe(IDS.OCT20_LINE)
    const ledger = await loadLedger(db, 'bca')
    expect(bankStatus(ledger, r.payment)).toEqual({ kind: 'linked', statementId: 'bca-2026-11' })
    expect(countedPayments(ledger.payments).map((p) => p.id)).not.toContain(IDS.OCT20_LINE)

    // P-12 once matched, amount and date come from the bank: a draft with other values keeps them.
    const kept = await saveAssign(db, { cardId: 'bca', paymentId: r.payment.id, date: '2026-10-01', amount: 9, ownerIds: ['Andi'], multi: false, allocations: {} }, null)
    expect([kept.payment.amount, kept.payment.date]).toEqual([2_000_000, '2026-10-18'])
  })

  it('P-14 a hand payment 6 days from the bank line is not matched, and is flagged after the next statement', async () => {
    const db = await smallDb()
    await db.payments.put(pay('line', '2026-10-05', 120_000, { source: 'statement', statementId: OCT.id }))
    const r = await saveAssign(db, draft({ date: '2026-09-29', amount: 120_000 }), null)
    expect(r.linkedTo).toBeUndefined()
    expect(bankStatus(await loadLedger(db, 'bca'), r.payment)).toEqual({ kind: 'missing', statementId: OCT.id })
  })

  it('P-12 a bank payment keeps its amount and date', async () => {
    const db = await smallDb()
    await db.payments.put(pay('line', '2026-10-05', 120_000, { source: 'statement', statementId: OCT.id }))
    const r = await saveAssign(db, draft({ paymentId: 'line', date: '2026-10-30', amount: 500_000, allocations: { t1: 120_000 } }), null)
    expect(r.payment).toMatchObject({ amount: 120_000, date: '2026-10-05', allocations: [{ txId: 't1', amount: 120_000 }] })
  })

  it('refuses what it cannot save', async () => {
    const db = await smallDb()
    await expect(saveAssign(db, draft({ paymentId: 'gone' }), null)).rejects.toThrow(PaymentError)
    await expect(saveAssign(db, draft({ cardId: 'nope' }), null)).rejects.toThrow('This card no longer exists.')
    await expect(saveAssign(db, draft({ date: '' }), null)).rejects.toThrow('Pick the date you transferred.')
    await expect(saveAssign(db, draft({ ownerIds: ['mdr-andi'] }), null)).rejects.toThrow('Pick an owner of this card.')
    await expect(saveAssign(db, draft({}), 'ghost')).rejects.toThrow('Pick an owner of this card.')
    // P-09 over-assigned: the domain refuses, in the user's words.
    await expect(saveAssign(db, draft({ amount: 100_000, allocations: { t1: 200_000 } }), null)).rejects.toThrow('Assigned more than the payment, or nothing assigned.')
    await expect(saveAssign(db, draft({ allocations: { gone: 1 } }), null)).rejects.toThrow('A charge on this payment no longer exists. Open the payment again.')
    await db.payments.put(pay('m', '2026-10-05', 10_000, { cardId: 'mdr' }))
    await expect(saveAssign(db, draft({ paymentId: 'm' }), null)).rejects.toThrow('This payment is on another card now. Open it again.')
    expect(await db.payments.count()).toBe(1)
  })
})

describe('saveAssign guards', () => {
  it('a bank line merged into a hand-recorded payment cannot be assigned too (it would count twice)', async () => {
    const db = await smallDb()
    await db.payments.bulkPut([
      pay('line', '2026-10-06', 300_000, { source: 'statement', statementId: OCT.id }),
      pay('hand', '2026-10-05', 300_000, { linkedStatementLine: 'line', allocations: [{ txId: 't1', amount: 300_000 }] }),
    ])
    await expect(saveAssign(db, draft({ paymentId: 'line', amount: 300_000, allocations: { t1: 300_000 } }), null)).rejects.toThrow(LINKED_LINE)
    expect((await db.payments.get('line'))!.allocations).toEqual([])
    expect(paidOf(computeMoney(await loadLedger(db, 'bca')), 't1')).toBe(300_000)
  })

  it('saving a new payment twice with its id updates it instead of adding a second one', async () => {
    const db = await smallDb()
    const id = newPaymentId()
    const first = await saveAssign(db, draft({ amount: 300_000, allocations: { t1: 300_000 } }), null, { newId: id })
    const second = await saveAssign(db, draft({ amount: 300_000, allocations: { t1: 300_000 } }), null, { newId: id })
    expect([first.payment.id, second.payment.id]).toEqual([id, id])
    expect(await db.payments.count()).toBe(1)
    // The retry does not see its own first write as another payment on the charge.
    expect(paidOf(computeMoney(await loadLedger(db, 'bca')), 't1')).toBe(300_000)
  })

  it('friendlyMoneyError words other money errors plainly', () => {
    expect(friendlyMoneyError(new MoneyError('assigned amount must be an integer number of rupiah, got 1.5'))).toBe('Enter the amounts in whole rupiah.')
  })
})

describe('payment actions', () => {
  it('P-15 Keep waiting: the 5 Sep Bima payment shows "Still waiting" and no longer blocks as missing', async () => {
    const db = await seedHousehold(freshNewDb())
    const [bima] = handPayments()
    await db.payments.put(bima)
    expect(bankStatus(await loadLedger(db, 'bca'), bima)).toEqual({ kind: 'missing', statementId: 'bca-2026-09' })
    const next = await keepPaymentWaiting(db, bima.id)
    expect(next.waiting).toBe(true)
    expect(bankStatus(await loadLedger(db, 'bca'), next)).toEqual({ kind: 'waiting', statementId: 'bca-2026-09' })
    await expect(keepPaymentWaiting(db, 'gone')).rejects.toThrow('This payment no longer exists.')
  })

  it('P-16 Paid to another card: moves with the owner mapped by name and assignments cleared; matched there', async () => {
    const db = await smallDb()
    await db.payments.bulkPut([
      pay('h', '2026-10-15', 400_000, { allocations: [{ txId: 't1', amount: 300_000 }], depositOwnerId: 'andi', forOwnerIds: ['andi'] }),
      pay('mdr-line', '2026-10-17', 400_000, { cardId: 'mdr', source: 'unbilled', statementId: 'mdr-unbilled' }),
    ])
    const r = await movePayment(db, 'h', 'mdr')
    expect(r.linkedTo?.id).toBe('mdr-line')
    expect(r.payment).toMatchObject({ cardId: 'mdr', allocations: [], forOwnerIds: ['mdr-andi'], linkedStatementLine: 'mdr-line' })
    expect(r.payment).not.toHaveProperty('depositOwnerId')
    const bca = await loadLedger(db, 'bca')
    expect(paidOf(computeMoney(bca), 't1')).toBe(0)

    await db.payments.put(pay('h2', '2026-10-15', 7_000, { forOwnerIds: ['sari'] }))
    const plain = await movePayment(db, 'h2', 'mdr')
    expect(plain.linkedTo).toBeUndefined()
    expect(plain.payment.forOwnerIds).toEqual([])

    await db.payments.put(pay('line', '2026-10-05', 120_000, { source: 'statement', statementId: OCT.id }))
    await expect(movePayment(db, 'line', 'mdr')).rejects.toThrow('Only a payment you recorded by hand can move to another card.')
    await expect(movePayment(db, 'h2', 'mdr')).rejects.toThrow('Pick another card.')
    await expect(movePayment(db, 'h2', 'bca-x')).rejects.toThrow('This card no longer exists.')
    // A payment matched to a bank line stays with that line.
    await expect(movePayment(db, 'h', 'bca')).rejects.toThrow("This payment is matched to this card's bank line, so it can't move.")
  })

  it('P-17 Transfer failed, delete: the payment is gone and the charge it paid is unpaid again; bank lines stay', async () => {
    const db = await seedHousehold(freshNewDb())
    const d: AssignDraft = { cardId: 'bca', date: '2026-09-05', amount: 300_000, ownerIds: ['Bima'], multi: false, allocations: {} }
    const r = await saveAssign(db, fillOldestFirst(await loadLedger(db, 'bca'), d).draft, 'Bima')
    expect(ownerBill(await loadLedger(db, 'bca'), 'Bima', 'bca-2026-09', TODAY).mustPay).toBe(0)
    await removePayment(db, r.payment.id)
    expect(await db.payments.get(r.payment.id)).toBeUndefined()
    expect(ownerBill(await loadLedger(db, 'bca'), 'Bima', 'bca-2026-09', TODAY).mustPay).toBe(290_000)
    await expect(removePayment(db, IDS.OCT30_LINE)).rejects.toThrow('A payment printed on a statement cannot be deleted.')
    await expect(removePayment(db, 'gone')).rejects.toThrow(PaymentError)
  })

  it('deleting an Unbilled line clears the match of the hand payment that pointed at it', async () => {
    const db = await smallDb()
    await db.payments.bulkPut([
      pay('u', '2026-10-06', 50_000, { source: 'unbilled', statementId: UNB }),
      pay('hand', '2026-10-05', 50_000, { linkedStatementLine: 'u', allocations: [{ txId: 't2', amount: 50_000 }] }),
    ])
    await removePayment(db, 'u')
    const hand = (await db.payments.get('hand'))!
    expect(hand).not.toHaveProperty('linkedStatementLine')
    expect(hand.allocations).toEqual([{ txId: 't2', amount: 50_000 }])
    expect(await db.payments.count()).toBe(1)
  })
})
