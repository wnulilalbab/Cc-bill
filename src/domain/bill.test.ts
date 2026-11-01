import { describe, expect, it } from 'vitest'
import { billed, ledger, months, pay, tx, unbilled } from '../../test/domain/builders'
import { cardBill, coverageOf, feeOwner, ownerBill } from './bill'
import { MoneyError } from './money'
import type { InstallmentPlan } from './types'

const TODAY = '2026-11-01'
const withNov = () => [...months(), billed('nov', '2026-11-12', '2026-11-28')]
const plan: InstallmentPlan = { id: 'pl', cardId: 'c', ownerId: 'sari', name: 'Sepeda Statis', monthly: 751248, total: 6, start: '2026-10' }

describe('owner bill', () => {
  it('M-01 1.000.000 on S plus 400.000 unpaid on S−1 = 1.400.000, older listed under S−1', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('s1', 'oct', '2026-10-01', 1000000, 'sari'), tx('old', 'sep', '2026-09-01', 600000, 'sari'), tx('paidOld', 'aug', '2026-08-01', 50000, 'sari')],
      payments: [pay('p', '2026-09-20', 250000, { allocations: [{ txId: 'old', amount: 200000 }, { txId: 'paidOld', amount: 50000 }] })],
    })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.mustPay).toBe(1400000)
    expect(b.thisRemaining).toBe(1000000)
    expect(b.olderRemaining).toBe(400000)
    expect(b.older.map((g) => [g.statement.id, g.remaining, g.lines.map((x) => x.tx.id)])).toEqual([['sep', 400000, ['old']]])
    expect(b.settled).toBe(false)
  })

  it('M-02 a payment dated after the due date still lowers the bill (live) and is marked after due', () => {
    const l = ledger({ statements: months(), transactions: [tx('t', 'sep', '2026-09-05', 500000, 'sari'), tx('n', 'oct', '2026-10-01', 100000, 'sari')] })
    expect(ownerBill(l, 'sari', 'oct', TODAY).mustPay).toBe(600000)
    const late = pay('late', '2026-10-05', 300000, { allocations: [{ txId: 't', amount: 300000 }] })
    const onTime = pay('onTime', '2026-09-28', 100000, { allocations: [{ txId: 't', amount: 100000 }] })
    const after = { ...l, payments: [late, onTime] }
    expect(ownerBill(after, 'sari', 'oct', TODAY).mustPay).toBe(200000)
    expect(ownerBill(after, 'sari', 'sep', TODAY).mustPay).toBe(100000)
    expect(coverageOf(after, 't').payments).toEqual([
      { paymentId: 'late', date: '2026-10-05', amount: 300000, afterDue: true },
      { paymentId: 'onTime', date: '2026-09-28', amount: 100000, afterDue: false },
    ])
  })

  it('M-03 installment 1/6 of 751.248 viewed at S: 5 × 751.248 = 3.756.240 still to come', () => {
    const l = ledger({ statements: withNov(), plans: [plan], transactions: [tx('i1', 'oct', '2026-09-15', 751248, 'sari', { kind: 'installment', planId: 'pl' })] })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.installmentsToCome).toEqual([{ planId: 'pl', monthsLeft: 5, amount: 3756240 }])
    expect(b.installmentsToComeTotal).toBe(3756240)
    expect(b.mustPay).toBe(751248)
  })

  it('M-04 the same plan viewed at S+1: 4 × 751.248 (snapshot per statement)', () => {
    const l = ledger({ statements: withNov(), plans: [plan] })
    expect(ownerBill(l, 'sari', 'nov', TODAY).installmentsToComeTotal).toBe(4 * 751248)
    expect(ownerBill(l, 'sari', 'sep', TODAY).installmentsToComeTotal).toBe(6 * 751248)
    expect(ownerBill(l, 'andi', 'nov', TODAY).installmentsToCome).toEqual([])
  })

  it('M-D-20 a finished plan shows nothing to come; plans of other cards are ignored', () => {
    const l = ledger({ statements: [...withNov(), billed('apr', '2027-04-12', '2027-04-28')], plans: [plan, { ...plan, id: 'other', cardId: 'm' }] })
    expect(ownerBill(l, 'sari', 'apr', TODAY).installmentsToCome).toEqual([])
    expect(ownerBill(l, 'sari', 'nov', TODAY).installmentsToCome.map((f) => f.planId)).toEqual(['pl'])
  })

  it('M-05 a refund of 44.631 on S reduces the owner\'s S charges by 44.631, row status Refund', () => {
    const l = ledger({ statements: months(), transactions: [tx('shopee', 'oct', '2026-10-05', 44631, 'rumah'), tx('sate', 'oct', '2026-10-03', 283000, 'rumah'), tx('refund', 'oct', '2026-10-08', -44631, 'rumah')] })
    const b = ownerBill(l, 'rumah', 'oct', TODAY)
    expect(b.charges).toBe(283000)
    expect(b.mustPay).toBe(283000)
    expect(b.lines.find((x) => x.tx.id === 'refund')).toMatchObject({ effective: -44631, remaining: -44631, status: 'refund', paid: 0 })
  })

  it('M-06 a reversal and the purchase moved to installment are excluded from the totals', () => {
    const l = ledger({
      statements: months(),
      transactions: [
        tx('orig', 'sep', '2026-09-03', 4376200, 'sari', { cancelled: true }),
        tx('rev', 'oct', '2026-09-15', -4376200, 'sari', { kind: 'reversal', reverses: 'orig' }),
        tx('i1', 'oct', '2026-09-15', 729367, 'sari', { kind: 'installment' }),
      ],
    })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.charges).toBe(729367)
    expect(b.mustPay).toBe(729367)
    expect(b.older).toEqual([])
    expect(b.lines.map((x) => [x.tx.id, x.effective, x.status])).toEqual([['rev', 0, 'notCounted'], ['i1', 729367, 'unpaid']])
    expect(ownerBill(l, 'sari', 'sep', TODAY).mustPay).toBe(0)
  })

  it('M-07 fees and interest go to the card default owner without a Check', () => {
    expect(feeOwner({ id: 'c', name: 'BCA Keluarga', bank: 'BCA', defaultOwnerId: 'keluarga' })).toEqual({ ownerId: 'keluarga', check: false })
    expect(feeOwner({ id: 'c', name: 'X', bank: 'BCA', defaultOwnerId: null })).toEqual({ ownerId: null, check: true })
  })

  it('M-08 the Unbilled selection shows unbilled charges plus older unpaid from every billed statement', () => {
    const l = ledger({
      statements: months(),
      plans: [plan],
      transactions: [tx('u', 'unb', '2026-10-16', 320000, 'sari'), tx('o', 'oct', '2026-10-01', 150000, 'sari'), tx('a', 'aug', '2026-08-01', 70000, 'sari')],
    })
    const b = ownerBill(l, 'sari', 'unb', TODAY)
    expect(b.lines.map((x) => x.tx.id)).toEqual(['u'])
    expect(b.older.map((g) => g.statement.id)).toEqual(['oct', 'aug'])
    expect(b.olderRemaining).toBe(220000)
    expect(b.mustPay).toBe(540000)
    expect(b.notBilledYet).toEqual([])
    // Snapshot as of the latest billed statement (Oct): 5 months to come.
    expect(b.installmentsToComeTotal).toBe(5 * 751248)
  })

  it('M-D-21 Unbilled on a card with no billed statement uses today for installments', () => {
    const l = ledger({ statements: [unbilled()], plans: [{ ...plan, start: '2026-09' }] })
    expect(ownerBill(l, 'sari', 'unb', '2026-11-01').installmentsToCome).toEqual([{ planId: 'pl', monthsLeft: 3, amount: 3 * 751248 }])
  })

  it('M-D-22 a billed bill lists Unbilled rows as not billed yet (info only)', () => {
    const l = ledger({ statements: months(), transactions: [tx('u1', 'unb', '2026-10-16', 320000, 'sari'), tx('u2', 'unb', '2026-10-20', -20000, 'sari'), tx('o', 'oct', '2026-10-01', 150000, 'sari')] })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.notBilledYet.map((x) => x.tx.id)).toEqual(['u1', 'u2'])
    expect(b.notBilledYetTotal).toBe(300000)
    expect(b.mustPay).toBe(150000)
  })

  it('M-10 hero arithmetic: charges − already paid + older unpaid = total, to the rupiah', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('a', 'oct', '2026-10-01', 1252000, 'sari'), tx('b', 'oct', '2026-10-02', 355840, 'sari'), tx('r', 'oct', '2026-10-03', -40000, 'sari'), tx('old', 'sep', '2026-09-01', 381327, 'sari')],
      payments: [pay('p', '2026-10-05', 500000, { allocations: [{ txId: 'a', amount: 500000 }] }), pay('q', '2026-10-06', 81327, { allocations: [{ txId: 'old', amount: 81327 }] })],
    })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.charges).toBe(1567840)
    expect(b.alreadyPaid).toBe(500000)
    expect(b.olderRemaining).toBe(300000)
    expect(b.mustPay).toBe(1367840)
    expect(b.charges - b.alreadyPaid + b.olderRemaining).toBe(b.mustPay)
  })

  it('M-11 an owner with nothing open is settled (Paid ✓), never below 0', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('a', 'oct', '2026-10-01', 100000, 'sari'), tx('r', 'oct', '2026-10-03', -40000, 'sari')],
      payments: [pay('p', '2026-10-05', 100000, { allocations: [{ txId: 'a', amount: 100000 }] })],
    })
    const b = ownerBill(l, 'sari', 'oct', TODAY)
    expect(b.thisRemaining).toBe(-40000)
    expect(b.mustPay).toBe(0)
    expect(b.settled).toBe(true)
    expect(ownerBill(l, 'nobody', 'oct', TODAY)).toMatchObject({ mustPay: 0, settled: true, charges: 0, lines: [] })
  })

  it('M-D-23 an older refund nets against its own statement; a fully refunded older statement is not listed', () => {
    const l = ledger({
      statements: months(),
      transactions: [
        tx('s1', 'aug', '2026-07-21', 381327, 'andi'),
        tx('r1', 'aug', '2026-08-02', -381327, 'andi'),
        tx('s2', 'sep', '2026-09-01', 100000, 'andi'),
        tx('r2', 'sep', '2026-09-05', -30000, 'andi'),
        tx('paid', 'sep', '2026-09-06', 5000, 'andi'),
      ],
      payments: [pay('p', '2026-09-07', 5000, { allocations: [{ txId: 'paid', amount: 5000 }] })],
    })
    const b = ownerBill(l, 'andi', 'oct', TODAY)
    expect(b.older.map((g) => [g.statement.id, g.remaining, g.lines.map((x) => x.tx.id)])).toEqual([['sep', 70000, ['s2', 'r2']]])
    expect(b.mustPay).toBe(70000)
  })

  it('M-D-27 a refund credit on an older statement whose charge was already paid carries into later bills', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('s1', 'aug', '2026-07-21', 381327, 'andi'), tx('r1', 'aug', '2026-08-02', -381327, 'andi'), tx('n', 'oct', '2026-10-01', 500000, 'andi')],
      payments: [pay('p', '2026-07-26', 381327, { allocations: [{ txId: 's1', amount: 381327 }] })],
    })
    const b = ownerBill(l, 'andi', 'oct', TODAY)
    expect(b.older.map((g) => [g.statement.id, g.remaining, g.lines.map((x) => x.tx.id)])).toEqual([['aug', -381327, ['r1']]])
    expect(b.olderRemaining).toBe(-381327)
    expect(b.mustPay).toBe(118673)
    const small = { ...l, transactions: l.transactions.map((t) => (t.id === 'n' ? { ...t, amount: 1000 } : t)) }
    expect(ownerBill(small, 'andi', 'oct', TODAY)).toMatchObject({ mustPay: 0, settled: true })
  })

  it('M-D-24 deposit waiting is part of the bill', () => {
    const l = ledger({ statements: months(), transactions: [tx('a', 'oct', '2026-10-01', 100000, 'sari')], payments: [pay('p', '2026-10-30', 300000, { depositOwnerId: 'sari' })] })
    expect(ownerBill(l, 'sari', 'oct', TODAY).depositWaiting).toBe(300000)
    expect(ownerBill(l, 'andi', 'oct', TODAY).depositWaiting).toBe(0)
  })

  it('M-D-25 rejects an unknown statement', () => {
    expect(() => ownerBill(ledger({}), 'sari', 'nope', TODAY)).toThrow(MoneyError)
    expect(() => cardBill(ledger({}), [], 'nope', TODAY)).toThrow('unknown statement nope')
  })
})

describe('card bill', () => {
  it('M-09 the card tile total equals the sum of the owners\' bills for the selected statement', () => {
    const l = ledger({
      statements: months(),
      transactions: [
        tx('a', 'oct', '2026-10-01', 100000, 'sari'),
        tx('b', 'oct', '2026-10-02', 250000, 'andi'),
        tx('old', 'sep', '2026-09-02', 40000, 'andi'),
        tx('n', 'oct', '2026-10-03', 7000, null),
        tx('m', 'oct', '2026-10-03', 9000, 'sari', { cardId: 'm' }),
      ],
    })
    const c = cardBill(l, ['sari', 'andi', 'bima'], 'oct', TODAY)
    expect(c.owners.map((o) => [o.ownerId, o.mustPay])).toEqual([['sari', 100000], ['andi', 290000], ['bima', 0], [null, 7000]])
    expect(c.total).toBe(397000)
    expect(c.statementId).toBe('oct')
    const noNull = cardBill({ ...l, transactions: l.transactions.filter((t) => t.ownerId !== null) }, ['sari'], 'oct', TODAY)
    expect(noNull.owners.map((o) => o.ownerId)).toEqual(['sari'])
  })
})

describe('coverage', () => {
  it('M-D-26 lists covering payments and the deposit part; Unbilled rows are never after due', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('u', 'unb', '2026-10-16', 320000, 'sari')],
      payments: [pay('e', '2026-12-01', 20000, { allocations: [{ txId: 'u', amount: 20000 }, { txId: 'u', amount: 0 }] }), pay('d', '2026-10-10', 500000, { depositOwnerId: 'sari' })],
    })
    expect(coverageOf(l, 'u')).toEqual({ payments: [{ paymentId: 'e', date: '2026-12-01', amount: 20000, afterDue: false }], fromDeposit: 300000 })
    expect(() => coverageOf(l, 'nope')).toThrow('unknown transaction nope')
  })
})
