import { describe, expect, it } from 'vitest'
import { billed, ledger, months, pay, tx, unbilled } from '../../test/domain/builders'
import { computeMoney, depositLeftOf, ownerDepositLeft, paidOf } from './amounts'
import { paymentTab } from './payments'
import { convertToInstallment, monthsLeft, parseInstallment, parseInstallmentReversal, type ConversionResult } from './installments'
import type { InstallmentPlan, Ledger } from './types'

const plan: InstallmentPlan = { id: 'pl', cardId: 'c', ownerId: 'sari', name: 'x', monthly: 751248, total: 6, start: '2026-10' }

describe('parsing installment lines', () => {
  it('M-D-80 reads n/N from BCA and Mandiri lines', () => {
    expect(parseInstallment('CICILAN BCA KE 01 DARI 06, BLIBLI.COM')).toEqual({ n: 1, of: 6 })
    expect(parseInstallment('CICILAN BCA KE 12 DARI 12, GARMIN INDONESIA')).toEqual({ n: 12, of: 12 })
    expect(parseInstallment('UNIQLO AEON BSD 002/003')).toEqual({ n: 2, of: 3 })
    expect(parseInstallment('NETFLIX.COM')).toBeNull()
    expect(parseInstallment('CICILAN BCA KE 07 DARI 06, X')).toBeNull()
    expect(parseInstallment('CICILAN BCA KE 00 DARI 06, X')).toBeNull()
    expect(parseInstallment('ORDER 002/003 PAID')).toBeNull()
  })

  it('M-D-81 reads merchant and ref from an installment reversal', () => {
    expect(parseInstallmentReversal('REVERSAL CICILAN BCA BLIBLI.COM *121')).toEqual({ merchant: 'BLIBLI.COM', ref: '121' })
    expect(parseInstallmentReversal('reversal cicilan toko x *9a extra')).toEqual({ merchant: 'TOKO X', ref: '9A' })
    expect(parseInstallmentReversal('REVERSAL GRAB* A-1 JAKARTA')).toBeNull()
    expect(parseInstallmentReversal('REVERSAL CICILAN BCA BLIBLI.COM')).toBeNull()
  })
})

describe('months left', () => {
  it('M-03 a 6-month plan viewed at its first statement has 5 months to come', () => {
    const l = ledger({ statements: months() })
    expect(monthsLeft(plan, l.statements[2], l, '2026-11-01')).toBe(5)
  })

  it('M-04 one statement later 4 months; before the start the full plan; never below 0', () => {
    const l = ledger({ statements: [...months(), billed('nov', '2026-11-12', '2026-11-28'), billed('may', '2027-05-12', '2027-05-28')] })
    expect(monthsLeft(plan, l.statements[4], l, '2026-11-01')).toBe(4)
    expect(monthsLeft(plan, l.statements[1], l, '2026-11-01')).toBe(6)
    expect(monthsLeft(plan, l.statements[5], l, '2026-11-01')).toBe(0)
    expect(monthsLeft({ ...plan, start: '2026-12' }, l.statements[4], l, '2026-11-01')).toBe(6)
  })

  it('M-D-82 Unbilled uses the latest billed statement, or today without one', () => {
    const l = ledger({ statements: months() })
    expect(monthsLeft(plan, l.statements[3], l, '2027-03-01')).toBe(5)
    expect(monthsLeft(plan, unbilled('u2', 'other'), l, '2027-01-15')).toBe(2)
  })
})

/** Sep Blibli 4.376.200 (Sari), Oct reversal and installment 1/6 of 729.367. */
function blibli(extra: Partial<Ledger> = {}): Ledger {
  return ledger({
    statements: months(),
    transactions: [
      tx('orig', 'sep', '2026-09-03', 4376200, 'sari', { description: 'BLIBLI.COM *121 SEPEDA STATIS' }),
      tx('kidz', 'sep', '2026-08-30', 760000, 'bima', { description: 'KIDZANIA JAKARTA' }),
      tx('rev', 'oct', '2026-09-15', -4376200, 'sari', { kind: 'reversal', description: 'REVERSAL CICILAN BCA BLIBLI.COM *121' }),
      tx('i1', 'oct', '2026-09-15', 729367, 'keluarga', { kind: 'installment', description: 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM', installment: { n: 1, of: 6 }, check: true }),
    ],
    ...extra,
  })
}
const ok = (r: ReturnType<typeof convertToInstallment>) => r as ConversionResult

describe('installment conversion', () => {
  it('I-07 original and reversal stop counting, the payment moves to 1/N, the excess becomes the owner\'s deposit', () => {
    const p = pay('p', '2026-09-27', 1470000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 'orig', amount: 1000000 }, { txId: 'kidz', amount: 470000 }] })
    const l = blibli({ payments: [p] })
    const r = ok(convertToInstallment(l, 'rev', 'plan-new'))
    expect(r.originalId).toBe('orig')
    expect(r.reversalId).toBe('rev')
    expect(r.installmentId).toBe('i1')
    expect(r.conflicts).toEqual([])
    expect(r.payments).toEqual([{ ...p, allocations: [{ txId: 'kidz', amount: 470000 }, { txId: 'i1', amount: 729367 }], depositOwnerId: 'sari' }])
    expect(r.transactions).toEqual([
      { ...l.transactions[0], cancelled: true },
      { ...l.transactions[2], reverses: 'orig', ownerId: 'sari' },
      { ...l.transactions[3], ownerId: 'sari', planId: 'plan-new', check: false },
    ])
    expect(r.plan).toEqual({ id: 'plan-new', cardId: 'c', ownerId: 'sari', name: 'BLIBLI.COM *121 SEPEDA STATIS', monthly: 729367, total: 6, start: '2026-10' })

    const after: Ledger = {
      ...l,
      transactions: [l.transactions[1], ...r.transactions],
      payments: r.payments,
      plans: [r.plan],
    }
    const s = computeMoney(after)
    expect(paidOf(s, 'i1')).toBe(729367)
    expect(paidOf(s, 'orig')).toBe(0)
    expect(depositLeftOf(s, r.payments[0])).toBe(270633)
  })

  it('M-D-83 several payments move oldest first, capped by what is open on the installment', () => {
    const other = pay('other', '2026-09-20', 100000, { allocations: [{ txId: 'i1', amount: 100000 }] })
    const late = pay('late', '2026-09-27', 900000, { allocations: [{ txId: 'orig', amount: 600000 }, { txId: 'i1', amount: 29367 }], depositOwnerId: 'sari' })
    const early = pay('early', '2026-09-10', 500000, { allocations: [{ txId: 'orig', amount: 500000 }] })
    const r = ok(convertToInstallment(blibli({ payments: [late, other, early] }), 'rev', 'np'))
    // Room = 729.367 − 100.000 (other) − 29.367 (late, already on it) = 600.000.
    expect(r.payments.map((p) => [p.id, p.allocations, p.depositOwnerId])).toEqual([
      ['early', [{ txId: 'i1', amount: 500000 }], undefined],
      ['late', [{ txId: 'i1', amount: 129367 }], 'sari'],
    ])
    expect(r.conflicts).toEqual([])
  })

  it('M-D-84 with no room left the whole amount becomes the deposit; a deposit for someone else is a conflict', () => {
    const full = pay('full', '2026-09-20', 729367, { allocations: [{ txId: 'i1', amount: 729367 }] })
    const mine = pay('mine', '2026-09-27', 300000, { allocations: [{ txId: 'orig', amount: 300000 }] })
    const andis = pay('andis', '2026-09-28', 400000, { allocations: [{ txId: 'orig', amount: 200000 }], depositOwnerId: 'andi' })
    const r = ok(convertToInstallment(blibli({ payments: [full, mine, andis] }), 'rev', 'np'))
    expect(r.payments).toEqual([
      { ...mine, allocations: [], depositOwnerId: 'sari' },
      { ...andis, allocations: [], depositOwnerId: undefined },
    ])
    expect('depositOwnerId' in r.payments[1]).toBe(false)
    expect(r.conflicts).toEqual(['andis'])
  })

  it('M-D-89 a conflicted payment loses the other person\'s deposit: back to To assign, never 800.000 in Bima\'s deposit', () => {
    const base = blibli()
    const l: Ledger = {
      ...base,
      transactions: base.transactions.map((t) => (t.id === 'i1' ? { ...t, amount: 200000, description: 'CICILAN BCA KE 01 DARI 05, BLIBLI.COM', installment: { n: 1, of: 5 } } : t)),
      payments: [pay('p', '2026-09-27', 1100000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 'orig', amount: 1000000 }], depositOwnerId: 'bima' })],
    }
    const r = ok(convertToInstallment(l, 'rev', 'np'))
    expect(r.conflicts).toEqual(['p'])
    expect(r.payments).toEqual([{ id: 'p', cardId: 'c', source: 'statement', statementId: 'oct', date: '2026-09-27', amount: 1100000, allocations: [{ txId: 'i1', amount: 200000 }] }])
    const after = { ...l, transactions: l.transactions.map((t) => r.transactions.find((x) => x.id === t.id) ?? t), payments: r.payments }
    expect(ownerDepositLeft(computeMoney(after), 'bima')).toBe(0)
    expect(paymentTab(after, r.payments[0])).toBe('toAssign')
  })

  it('M-D-85 an original with no owner cannot pass its excess to a deposit', () => {
    const base = blibli()
    const l = { ...base, transactions: base.transactions.map((t) => (t.id === 'orig' ? { ...t, ownerId: null } : t)), payments: [pay('p', '2026-09-27', 5000000, { allocations: [{ txId: 'orig', amount: 4376200 }] })] }
    const r = ok(convertToInstallment(l, 'rev', 'np'))
    expect(r.conflicts).toEqual(['p'])
    expect(r.payments[0].depositOwnerId).toBeUndefined()
    expect(r.plan.ownerId).toBeNull()
  })

  it('M-D-86 links an existing plan; a conversion without payments moves nothing', () => {
    const base = blibli({ plans: [{ ...plan, id: 'pl' }] })
    const l = { ...base, transactions: base.transactions.map((t) => (t.id === 'i1' ? { ...t, planId: 'pl' } : t)) }
    const r = ok(convertToInstallment(l, 'rev', 'unused'))
    expect(r.plan).toEqual({ ...plan, id: 'pl' })
    expect(r.payments).toEqual([])
    expect(r.transactions[2].planId).toBe('pl')
  })

  it('M-D-87 picks the right original and installment 1/N', () => {
    const base = blibli()
    const l: Ledger = {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => t.id !== 'i1'),
        tx('older', 'aug', '2026-08-01', 4376200, 'andi', { description: 'BLIBLI.COM *121 LAMA' }),
        tx('afterRev', 'oct', '2026-09-20', 4376200, 'andi', { description: 'BLIBLI.COM *121 BARU' }),
        tx('otherAmount', 'sep', '2026-09-05', 4376201, 'andi', { description: 'BLIBLI.COM *121' }),
        tx('otherCard', 'sep', '2026-09-05', 4376200, 'andi', { description: 'BLIBLI.COM *121', cardId: 'm' }),
        tx('fee', 'sep', '2026-09-06', 4376200, 'andi', { description: 'BLIBLI.COM *121', kind: 'fee' }),
        tx('unbInst', 'unb', '2026-09-15', 729367, 'sari', { kind: 'installment', description: 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM' }),
        tx('octInst', 'oct', '2026-09-15', 729367, 'sari', { kind: 'installment', description: 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM' }),
        tx('second', 'oct', '2026-09-15', 729367, 'sari', { kind: 'installment', description: 'CICILAN BCA KE 02 DARI 06, BLIBLI.COM' }),
        tx('beforeOrig', 'aug', '2026-09-01', 729367, 'sari', { kind: 'installment', description: 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM' }),
        tx('otherShop', 'oct', '2026-09-15', 729367, 'sari', { kind: 'installment', description: 'CICILAN BCA KE 01 DARI 06, TOKO' }),
        tx('purchase1', 'oct', '2026-09-15', 729367, 'sari', { description: 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM' }),
      ],
    }
    const r = ok(convertToInstallment(l, 'rev', 'np'))
    expect([r.originalId, r.installmentId]).toEqual(['orig', 'octInst'])
    const onlyUnbilled = { ...l, transactions: l.transactions.filter((t) => t.id !== 'octInst') }
    const u = ok(convertToInstallment(onlyUnbilled, 'rev', 'np'))
    expect(u.installmentId).toBe('unbInst')
    expect(u.plan.start).toBe('2026-09')
  })

  it('M-D-88 explains what it could not convert', () => {
    const l = blibli()
    expect(convertToInstallment(l, 'nope', 'np')).toEqual({ error: 'notAReversal' })
    expect(convertToInstallment(l, 'orig', 'np')).toEqual({ error: 'notAReversal' })
    const plainReversal = { ...l, transactions: [...l.transactions, tx('r2', 'oct', '2026-10-01', -5, 'a', { kind: 'reversal', description: 'REVERSAL GRAB' })] }
    expect(convertToInstallment(plainReversal, 'r2', 'np')).toEqual({ error: 'notAReversal' })
    expect(convertToInstallment({ ...l, transactions: l.transactions.filter((t) => t.id !== 'orig') }, 'rev', 'np')).toEqual({ error: 'originalNotFound' })
    expect(convertToInstallment({ ...l, transactions: l.transactions.filter((t) => t.id !== 'i1') }, 'rev', 'np')).toEqual({ error: 'installmentNotFound' })
  })
})
