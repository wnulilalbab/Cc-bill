import { describe, expect, it } from 'vitest'
import { ledger, months, pay, tx } from '../../test/domain/builders'
import {
  allocatedOf,
  computeMoney,
  countedPayments,
  depositLeftOf,
  depositPaidOf,
  depositUsedOf,
  effective,
  explicitPaidOf,
  ownerDepositLeft,
  paidOf,
  remainingOf,
  txStatus,
  unassignedOf,
} from './amounts'
import { MoneyError } from './money'

describe('effective amount', () => {
  it('M-05 a refund counts as a negative charge', () => {
    expect(effective(tx('r', 'oct', '2026-10-08', -44631, 'rumah', { kind: 'refund' }))).toBe(-44631)
  })

  it('M-06 reversal rows and purchases moved to installment count 0', () => {
    expect(effective(tx('rev', 'oct', '2026-09-15', -4376200, 'sari', { kind: 'reversal' }))).toBe(0)
    expect(effective(tx('orig', 'sep', '2026-09-03', 4376200, 'sari', { cancelled: true }))).toBe(0)
    expect(effective(tx('p', 'sep', '2026-09-03', 4376200, 'sari'))).toBe(4376200)
  })

  it('M-D-10 refuses a non-integer amount', () => {
    expect(() => effective(tx('f', 'oct', '2026-10-01', 10.5, 'a'))).toThrow('transaction f amount must be an integer')
  })
})

describe('payments counted once', () => {
  it('P-13 a bank line matched by a hand-recorded payment is not counted again', () => {
    const line = pay('line', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct' })
    const other = pay('other', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct' })
    const hand = pay('hand', '2026-09-28', 1900000, { linkedStatementLine: 'line', allocations: [{ txId: 't', amount: 1900000 }] })
    expect(countedPayments([line, other, hand]).map((p) => p.id)).toEqual(['other', 'hand'])
    const state = computeMoney(ledger({ transactions: [tx('t', 'sep', '2026-09-01', 2000000, 'a')], payments: [line, hand] }))
    expect(paidOf(state, 't')).toBe(1900000)
    expect(state.payments.map((p) => p.id)).toEqual(['hand'])
  })

  it('M-D-11 a bank line keeps counting while the hand payment is not linked', () => {
    const line = pay('line', '2026-09-30', 100, { source: 'unbilled', statementId: 'unb' })
    expect(countedPayments([line, pay('hand', '2026-09-28', 100)]).map((p) => p.id)).toEqual(['line', 'hand'])
  })
})

describe('allocated and unassigned', () => {
  it('M-D-12 sums assignments and the part left over', () => {
    const p = pay('p', '2026-10-01', 500000, { allocations: [{ txId: 'a', amount: 300000 }, { txId: 'b', amount: 150000 }] })
    expect(allocatedOf(p)).toBe(450000)
    expect(unassignedOf(p)).toBe(50000)
    expect(unassignedOf({ ...p, allocations: [{ txId: 'a', amount: 600000 }] })).toBe(-100000)
  })

  it('M-D-13 rejects invalid payments', () => {
    expect(() => allocatedOf(pay('p', '2026-10-01', 0))).toThrow('payment p amount must be positive, got 0')
    expect(() => allocatedOf(pay('p', '2026-10-01', -5))).toThrow(MoneyError)
    expect(() => allocatedOf(pay('p', '2026-10-01', 1.5))).toThrow('payment p amount must be an integer')
    expect(() => allocatedOf(pay('p', '2026-10-01', 10, { allocations: [{ txId: 'a', amount: -1 }] }))).toThrow('payment p allocation to a is negative')
    expect(() => allocatedOf(pay('p', '2026-10-01', 10, { allocations: [{ txId: 'a', amount: 0.1 }] }))).toThrow('payment p allocation to a must be an integer')
    expect(allocatedOf(pay('p', '2026-10-01', 10, { allocations: [{ txId: 'a', amount: 0 }] }))).toBe(0)
    expect(() => computeMoney(ledger({ payments: [pay('p', '2026-10-01', 0)] }))).toThrow(MoneyError)
  })
})

describe('explicit payments', () => {
  it('M-D-14 adds up assignments to the same charge across payments', () => {
    const l = ledger({
      transactions: [tx('t', 'sep', '2026-09-01', 1252000, 'sari')],
      payments: [
        pay('p1', '2026-09-10', 500000, { allocations: [{ txId: 't', amount: 500000 }] }),
        pay('p2', '2026-09-20', 400000, { allocations: [{ txId: 't', amount: 300000 }, { txId: 't', amount: 100000 }] }),
      ],
    })
    const s = computeMoney(l)
    expect(explicitPaidOf(s, 't')).toBe(900000)
    expect(paidOf(s, 't')).toBe(900000)
    expect(remainingOf(s, l.transactions[0])).toBe(352000)
    expect(txStatus(s, l.transactions[0])).toBe('partial')
    expect(explicitPaidOf(s, 'unknown')).toBe(0)
    const without = computeMoney(l, 'p1')
    expect(paidOf(without, 't')).toBe(400000)
    expect(without.payments.map((p) => p.id)).toEqual(['p2'])
  })

  it('M-D-15 remaining never goes below 0 and statuses follow it', () => {
    const t = tx('t', 'sep', '2026-09-01', 100000, 'a')
    const over = computeMoney(ledger({ transactions: [t], payments: [pay('p', '2026-09-02', 150000, { allocations: [{ txId: 't', amount: 150000 }] })] }))
    expect(remainingOf(over, t)).toBe(0)
    expect(txStatus(over, t)).toBe('paid')
    const none = computeMoney(ledger({ transactions: [t] }))
    expect(remainingOf(none, t)).toBe(100000)
    expect(txStatus(none, t)).toBe('unpaid')
    expect(remainingOf(none, tx('r', 'sep', '2026-09-01', -44631, 'a'))).toBe(-44631)
    expect(txStatus(none, tx('r', 'sep', '2026-09-01', -44631, 'a'))).toBe('refund')
    expect(remainingOf(none, tx('v', 'sep', '2026-09-01', -500, 'a', { kind: 'reversal' }))).toBe(0)
    expect(txStatus(none, tx('v', 'sep', '2026-09-01', -500, 'a', { kind: 'reversal' }))).toBe('notCounted')
    expect(txStatus(none, tx('c', 'sep', '2026-09-01', 500, 'a', { cancelled: true }))).toBe('notCounted')
    expect(txStatus(none, tx('z', 'sep', '2026-09-01', 0, 'a'))).toBe('paid')
  })
})

describe('deposits', () => {
  const sariCharge = tx('toko', 'unb', '2026-10-16', 320000, 'sari')
  const deposit = pay('p', '2026-10-10', 1500000, { allocations: [{ txId: 'x', amount: 400000 }], depositOwnerId: 'sari' })

  it('D-01 a 1.100.000 deposit dated 10 Oct pays a 320.000 charge on 16 Oct, 780.000 left', () => {
    const l = ledger({ statements: months(), transactions: [sariCharge, tx('x', 'oct', '2026-10-01', 400000, 'andi')], payments: [deposit] })
    const s = computeMoney(l)
    expect(depositPaidOf(s, 'toko')).toBe(320000)
    expect(paidOf(s, 'toko')).toBe(320000)
    expect(txStatus(s, sariCharge)).toBe('paid')
    expect(depositUsedOf(s, deposit)).toBe(320000)
    expect(depositLeftOf(s, deposit)).toBe(780000)
    expect(ownerDepositLeft(s, 'sari')).toBe(780000)
    expect(ownerDepositLeft(s, 'andi')).toBe(0)
    expect(ownerDepositLeft(s, null)).toBe(0)
  })

  it('D-02 a charge dated before the deposit date is not paid by it; one on the same day is', () => {
    const before = tx('before', 'oct', '2026-10-09', 100000, 'sari')
    const sameDay = tx('same', 'oct', '2026-10-10', 50000, 'sari')
    const s = computeMoney(ledger({ transactions: [before, sameDay, tx('x', 'oct', '2026-10-01', 400000, 'andi')], payments: [deposit] }))
    expect(depositPaidOf(s, 'before')).toBe(0)
    expect(depositPaidOf(s, 'same')).toBe(50000)
    expect(depositLeftOf(s, deposit)).toBe(1050000)
  })

  it('D-03 two deposits are applied in payment-date order, charges oldest first', () => {
    const later = pay('later', '2026-10-20', 100000, { depositOwnerId: 'sari' })
    const earlier = pay('earlier', '2026-10-10', 50000, { depositOwnerId: 'sari' })
    const c2 = tx('c2', 'unb', '2026-10-26', 40000, 'sari')
    const c1 = tx('c1', 'unb', '2026-10-25', 120000, 'sari')
    const s = computeMoney(ledger({ transactions: [c2, c1], payments: [later, earlier] }))
    expect(depositUsedOf(s, earlier)).toBe(50000)
    expect(depositUsedOf(s, later)).toBe(100000)
    expect(depositPaidOf(s, 'c1')).toBe(120000)
    expect(depositPaidOf(s, 'c2')).toBe(30000)
    expect(remainingOf(s, c2)).toBe(10000)
    expect(ownerDepositLeft(s, 'sari')).toBe(0)
  })

  it('D-04 an explicit assignment added later makes the deposit re-flow, never paying twice', () => {
    const base = ledger({ transactions: [sariCharge, tx('x', 'oct', '2026-10-01', 400000, 'andi')], payments: [deposit] })
    const added = { ...base, payments: [...base.payments, pay('e', '2026-10-17', 200000, { allocations: [{ txId: 'toko', amount: 200000 }] })] }
    const s = computeMoney(added)
    expect(explicitPaidOf(s, 'toko')).toBe(200000)
    expect(depositPaidOf(s, 'toko')).toBe(120000)
    expect(paidOf(s, 'toko')).toBe(320000)
    expect(depositLeftOf(s, deposit)).toBe(980000)
    const fullyExplicit = { ...base, payments: [...base.payments, pay('e', '2026-10-17', 400000, { allocations: [{ txId: 'toko', amount: 400000 }] })] }
    const s2 = computeMoney(fullyExplicit)
    expect(depositPaidOf(s2, 'toko')).toBe(0)
    expect(depositLeftOf(s2, deposit)).toBe(1100000)
  })

  it('D-05 a fully used deposit shows used with 0 left', () => {
    const small = pay('small', '2026-10-10', 300000, { depositOwnerId: 'sari' })
    const s = computeMoney(ledger({ transactions: [sariCharge], payments: [small] }))
    expect(depositUsedOf(s, small)).toBe(300000)
    expect(depositLeftOf(s, small)).toBe(0)
    expect(ownerDepositLeft(s, 'sari')).toBe(0)
    expect(remainingOf(s, sariCharge)).toBe(20000)
  })

  it('M-D-16 a deposit only pays its own owner\'s counted charges on the same card', () => {
    const p = pay('p', '2026-10-01', 100000, { depositOwnerId: 'sari' })
    const s = computeMoney(
      ledger({
        transactions: [
          tx('other-owner', 'oct', '2026-10-02', 10000, 'andi'),
          tx('other-card', 'oct', '2026-10-02', 10000, 'sari', { cardId: 'm' }),
          tx('refund', 'oct', '2026-10-02', -10000, 'sari'),
          tx('cancelled', 'oct', '2026-10-02', 10000, 'sari', { cancelled: true }),
          tx('mine', 'oct', '2026-10-03', 10000, 'sari'),
        ],
        payments: [p],
      }),
    )
    expect([...s.fromDeposit.entries()]).toEqual([['mine', 10000]])
    expect(depositLeftOf(s, p)).toBe(90000)
  })

  it('M-D-17 a charge already over-covered explicitly takes nothing from a deposit', () => {
    const t = tx('t', 'oct', '2026-10-05', 100000, 'sari')
    const s = computeMoney(
      ledger({
        transactions: [t],
        payments: [pay('dep', '2026-10-01', 50000, { depositOwnerId: 'sari' }), pay('e', '2026-10-06', 120000, { allocations: [{ txId: 't', amount: 120000 }] })],
      }),
    )
    expect(depositPaidOf(s, 't')).toBe(0)
    expect(ownerDepositLeft(s, 'sari')).toBe(50000)
  })

  it('M-D-18 a deposit owner on a payment with nothing left over has no deposit', () => {
    const full = pay('full', '2026-10-01', 100, { allocations: [{ txId: 'a', amount: 100 }], depositOwnerId: 'sari' })
    const over = pay('over', '2026-10-01', 100, { allocations: [{ txId: 'a', amount: 130 }], depositOwnerId: 'sari' })
    const s = computeMoney(ledger({ transactions: [tx('a', 'oct', '2026-09-01', 500, 'x'), tx('b', 'oct', '2026-10-05', 500, 'sari')], payments: [full, over] }))
    expect(depositUsedOf(s, full)).toBe(0)
    expect(depositLeftOf(s, full)).toBe(0)
    expect(depositLeftOf(s, over)).toBe(0)
    expect(depositPaidOf(s, 'b')).toBe(0)
    expect(depositLeftOf(s, pay('plain', '2026-10-01', 100))).toBe(0)
    expect(depositUsedOf(s, pay('unknown', '2026-10-01', 100))).toBe(0)
  })

  it('M-D-19 a payment being edited is left out of the deposit flow', () => {
    const l = ledger({ transactions: [sariCharge, tx('x', 'oct', '2026-10-01', 400000, 'andi')], payments: [deposit] })
    const s = computeMoney(l, 'p')
    expect(depositPaidOf(s, 'toko')).toBe(0)
    expect(s.depositUsed.size).toBe(0)
  })
})
