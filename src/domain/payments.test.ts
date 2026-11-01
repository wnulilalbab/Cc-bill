import { describe, expect, it } from 'vitest'
import { billed, ledger, months, pay, tx } from '../../test/domain/builders'
import { computeMoney } from './amounts'
import {
  allocStatus,
  bankStatus,
  blocks,
  canEditAmountAndDate,
  deletePayment,
  deleteTransaction,
  keepWaiting,
  keepWaitingRow,
  MISSING_GRACE_DAYS,
  moveToCard,
  paymentTab,
  printedOn,
} from './payments'
import { MATCH_WINDOW_DAYS } from './matching'
import type { Owner } from './types'

const stmts = months()
const [aug, sep, oct, unb] = stmts

describe('bank status', () => {
  it('M-D-30 bank lines are on their statement or in Unbilled', () => {
    const l = ledger({ statements: stmts })
    expect(bankStatus(l, pay('s', '2026-09-27', 1, { source: 'statement', statementId: 'oct' }))).toEqual({ kind: 'onStatement', statementId: 'oct' })
    expect(bankStatus(l, pay('u', '2026-10-20', 1, { source: 'unbilled', statementId: 'unb' }))).toEqual({ kind: 'unbilled', statementId: 'unb' })
  })

  it('P-13 a matched hand payment is shown on the statement of its bank line', () => {
    const line = pay('line', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct' })
    const hand = pay('hand', '2026-09-28', 1900000, { linkedStatementLine: 'line' })
    expect(bankStatus(ledger({ statements: stmts, payments: [line, hand] }), hand)).toEqual({ kind: 'linked', statementId: 'oct' })
    // A link to a line that no longer exists counts as not found.
    expect(bankStatus(ledger({ statements: stmts, payments: [hand] }), hand)).toEqual({ kind: 'missing', statementId: 'oct' })
    // Only bank lines can be linked to.
    const otherHand = pay('line', '2026-09-30', 1900000)
    expect(bankStatus(ledger({ statements: stmts, payments: [otherHand, hand] }), hand).kind).toBe('missing')
  })

  it('P-14 a hand payment with no line becomes missing on the first statement dated ≥5 days after it (= the match window)', () => {
    const l = ledger({ statements: stmts })
    expect(MISSING_GRACE_DAYS).toBe(5)
    expect(MISSING_GRACE_DAYS).toBe(MATCH_WINDOW_DAYS)
    expect(bankStatus(l, pay('bima', '2026-09-05', 300000))).toEqual({ kind: 'missing', statementId: 'sep' })
    expect(bankStatus(l, pay('edge', '2026-09-07', 1))).toEqual({ kind: 'missing', statementId: 'sep' })
    expect(bankStatus(l, pay('grace', '2026-09-08', 1))).toEqual({ kind: 'missing', statementId: 'oct' })
    expect(bankStatus(l, pay('recent', '2026-10-10', 1))).toEqual({ kind: 'pending' })
    expect(bankStatus(l, pay('other', '2026-09-05', 1, { cardId: 'm' }))).toEqual({ kind: 'pending' })
  })

  it('P-15 Keep waiting: status Still waiting', () => {
    const l = ledger({ statements: stmts })
    const p = keepWaiting(pay('bima', '2026-09-05', 300000))
    expect(p.waiting).toBe(true)
    expect(bankStatus(l, p)).toEqual({ kind: 'waiting', statementId: 'sep' })
    expect(paymentTab(ledger({ statements: stmts, payments: [p] }), p)).toBe('toAssign')
  })

  it('M-D-31 printedOn gives the statement for bank and matched payments only', () => {
    const line = pay('line', '2026-10-20', 5, { source: 'unbilled', statementId: 'unb' })
    const hand = pay('hand', '2026-10-18', 5, { linkedStatementLine: 'line' })
    const l = ledger({ statements: stmts, payments: [line, hand] })
    expect(printedOn(l, line)).toBe('unb')
    expect(printedOn(l, hand)).toBe('unb')
    expect(printedOn(l, pay('s', '2026-09-27', 1, { source: 'statement', statementId: 'oct' }))).toBe('oct')
    expect(printedOn(l, pay('x', '2026-09-05', 1))).toBeUndefined()
  })

  it('P-12 bank payments have read-only amount and date', () => {
    expect(canEditAmountAndDate(pay('s', '2026-09-27', 1, { source: 'statement', statementId: 'oct' }))).toBe(false)
    expect(canEditAmountAndDate(pay('u', '2026-09-27', 1, { source: 'unbilled', statementId: 'unb' }))).toBe(false)
    expect(canEditAmountAndDate(pay('m', '2026-09-27', 1))).toBe(true)
    // Matched to a bank line: the bank amount and date are the truth.
    expect(canEditAmountAndDate(pay('h', '2026-09-28', 1, { linkedStatementLine: 'l' }))).toBe(false)
  })

  it('M-D-34 a hand payment next to an already-assigned bank line of the same amount is a possible duplicate', () => {
    const assigned = pay('line', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 't', amount: 1900000 }] })
    const deposited = pay('dline', '2026-09-30', 700000, { source: 'unbilled', statementId: 'unb', depositOwnerId: 'sari' })
    const hand = pay('hand', '2026-09-28', 1900000)
    const l = ledger({ statements: stmts, payments: [assigned, deposited, hand] })
    expect(bankStatus(l, hand)).toEqual({ kind: 'possibleDuplicate', lineId: 'line' })
    expect(bankStatus(l, pay('h7', '2026-10-05', 700000))).toEqual({ kind: 'possibleDuplicate', lineId: 'dline' })
    expect(paymentTab(l, hand)).toBe('recordedNotOnStatement')
    // Kept waiting, too far, a free line (the matcher will link it), or a line another hand payment took: no warning.
    expect(bankStatus(l, keepWaiting(hand))).toEqual({ kind: 'waiting', statementId: 'oct' })
    expect(bankStatus(l, pay('far', '2026-09-24', 1900000)).kind).toBe('missing')
    const free = ledger({ statements: stmts, payments: [pay('fl', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct' }), hand] })
    expect(bankStatus(free, hand).kind).toBe('missing')
    const taken = ledger({ statements: stmts, payments: [assigned, pay('other', '2026-09-29', 1900000, { linkedStatementLine: 'line' }), hand] })
    expect(bankStatus(taken, hand).kind).toBe('missing')
  })
})

describe('blocks', () => {
  const l = ledger({ statements: stmts })
  const open = (extra = {}) => pay('p', '2026-09-20', 100000, extra)

  it('F-02 a bank line printed on S blocks S only', () => {
    const p = open({ source: 'statement', statementId: 'oct' })
    expect(blocks(l, p, oct)).toBe(true)
    expect(blocks(l, p, sep)).toBe(false)
    expect(blocks(l, p, unb)).toBe(false)
  })

  it('F-03 an Unbilled payment line does not block the previous bill', () => {
    const p = pay('u', '2026-10-20', 100000, { source: 'unbilled', statementId: 'unb' })
    expect(blocks(l, p, oct)).toBe(false)
    expect(blocks(l, p, unb)).toBe(true)
  })

  it('F-04 a hand payment after S−1\'s date and on/before S\'s due date blocks S', () => {
    expect(blocks(l, open(), oct)).toBe(true)
    expect(blocks(l, open({ date: '2026-10-28' }), oct)).toBe(true)
    expect(blocks(l, open({ date: '2026-10-29' }), oct)).toBe(false)
    expect(blocks(l, open({ date: '2026-09-12' }), oct)).toBe(false)
    expect(blocks(l, open({ date: '2026-09-12' }), sep)).toBe(true)
    expect(blocks(l, open({ date: '2026-09-13' }), oct)).toBe(true)
    expect(blocks(l, open({ date: '2026-01-01' }), aug)).toBe(true)
    expect(blocks(l, open(), unb)).toBe(false)
  })

  it('F-05 a payment whose leftover is kept as a deposit does not block', () => {
    expect(blocks(l, open({ depositOwnerId: 'sari' }), oct)).toBe(false)
    expect(blocks(l, open({ source: 'statement', statementId: 'oct', depositOwnerId: 'sari' }), oct)).toBe(false)
  })

  it('F-06 a payment with a leftover left to "Decide later" blocks', () => {
    expect(blocks(l, open({ allocations: [{ txId: 't', amount: 60000 }] }), oct)).toBe(true)
    expect(blocks(l, open({ allocations: [{ txId: 't', amount: 100000 }] }), oct)).toBe(false)
    expect(blocks(l, open({ cardId: 'm' }), oct)).toBe(false)
  })

  it('M-D-32 a matched hand payment blocks the statement its line is printed on too', () => {
    const line = pay('line', '2026-10-20', 2000000, { source: 'statement', statementId: 'nov' })
    const hand = pay('hand', '2026-10-18', 2000000, { linkedStatementLine: 'line' })
    const withNov = ledger({ statements: [...stmts, billed('nov', '2026-11-12', '2026-11-28')], payments: [line, hand] })
    expect(blocks(withNov, hand, withNov.statements[4])).toBe(true)
    expect(blocks(withNov, hand, oct)).toBe(true)
  })
})

describe('allocation status and tabs', () => {
  it('M-D-33 says whether a payment is fully assigned, a deposit, partly or not assigned', () => {
    const t = tx('t', 'oct', '2026-10-15', 30000, 'sari')
    const dep = pay('d', '2026-10-10', 100000, { depositOwnerId: 'sari' })
    const s = computeMoney(ledger({ transactions: [t], payments: [dep] }))
    expect(allocStatus(s, pay('f', '2026-10-01', 10, { allocations: [{ txId: 't', amount: 10 }] }))).toEqual({ kind: 'full' })
    expect(allocStatus(s, dep)).toEqual({ kind: 'deposit', ownerId: 'sari', used: 30000, left: 70000 })
    expect(allocStatus(s, pay('n', '2026-10-01', 10))).toEqual({ kind: 'none', left: 10 })
    expect(allocStatus(s, pay('z', '2026-10-01', 10, { allocations: [{ txId: 't', amount: 0 }] }))).toEqual({ kind: 'none', left: 10 })
    expect(allocStatus(s, pay('p', '2026-10-01', 10, { allocations: [{ txId: 't', amount: 4 }] }))).toEqual({ kind: 'partial', left: 6 })
  })

  it('P-19 Payments tab: To assign / Recorded, not on a statement / Done', () => {
    const toAssign = pay('a', '2026-10-01', 100, { source: 'statement', statementId: 'oct' })
    const missing = pay('m', '2026-09-05', 300000, { allocations: [{ txId: 't', amount: 300000 }] })
    const missingOpen = pay('mo', '2026-09-06', 300000)
    const done = pay('d', '2026-10-01', 100, { source: 'statement', statementId: 'oct', allocations: [{ txId: 't', amount: 100 }] })
    const deposited = pay('dep', '2026-10-01', 100, { source: 'statement', statementId: 'oct', depositOwnerId: 'sari' })
    const line = pay('line', '2026-10-20', 7, { source: 'unbilled', statementId: 'unb' })
    const hand = pay('hand', '2026-10-18', 7, { linkedStatementLine: 'line' })
    const l = ledger({ statements: stmts, payments: [toAssign, missing, missingOpen, done, deposited, line, hand] })
    expect(l.payments.map((p) => paymentTab(l, p))).toEqual(['toAssign', 'recordedNotOnStatement', 'recordedNotOnStatement', 'done', 'done', null, 'toAssign'])
  })
})

describe('resolving payments and rows', () => {
  const owners: Owner[] = [
    { id: 'b-sari', cardId: 'c', name: 'Sari' },
    { id: 'b-andi', cardId: 'c', name: 'Andi' },
    { id: 'm-andi', cardId: 'm', name: 'Andi' },
    { id: 'm-rumah', cardId: 'm', name: 'Rumah' },
    { id: 'm-sari', cardId: 'm', name: 'Sari' },
  ]

  it('P-16 Paid to another card: moves it, maps the owner by name, clears assignments', () => {
    const transactions = [tx('t', 'sep', '2026-09-01', 500000, 'b-andi'), tx('n', 'sep', '2026-09-01', 1, null)]
    const p = pay('p', '2026-09-05', 300000, {
      allocations: [{ txId: 't', amount: 200000 }, { txId: 'n', amount: 1 }, { txId: 'gone', amount: 5 }],
      depositOwnerId: 'b-sari',
      linkedStatementLine: 'x',
    })
    const moved = moveToCard(p, 'm', transactions, owners)
    expect(moved).toEqual({ id: 'p', cardId: 'm', source: 'manual', date: '2026-09-05', amount: 300000, allocations: [], forOwnerIds: ['m-andi', 'm-sari'], waiting: true })
    const noOwners = moveToCard(pay('q', '2026-09-05', 1, { forOwnerIds: ['b-andi', 'zzz'] }), 'm', transactions, owners)
    expect(noOwners.forOwnerIds).toEqual(['m-andi'])
    expect(moveToCard(pay('r', '2026-09-05', 1), 'm', transactions, owners).forOwnerIds).toEqual([])
  })

  it('P-17 Transfer failed: the payment is deleted', () => {
    const list = [pay('a', '2026-09-05', 1), pay('b', '2026-09-06', 2)]
    expect(deletePayment(list, 'a').map((p) => p.id)).toEqual(['b'])
    expect(list).toHaveLength(2)
  })

  it('I-10 an Unbilled row not on the new statement can be kept waiting or deleted (its payments get the amount back)', () => {
    const row = tx('ghost', 'unb', '2026-10-09', 27000, 'andi')
    expect(keepWaitingRow(row)).toEqual({ ...row, keepWaiting: true })
    const p = pay('p', '2026-10-10', 50000, { allocations: [{ txId: 'ghost', amount: 27000 }, { txId: 'keep', amount: 1000 }] })
    const other = pay('o', '2026-10-10', 5)
    const after = deleteTransaction({ transactions: [row, tx('keep', 'unb', '2026-10-09', 1000, 'andi')], payments: [p, other] }, 'ghost')
    expect(after.transactions.map((t) => t.id)).toEqual(['keep'])
    expect(after.payments[0].allocations).toEqual([{ txId: 'keep', amount: 1000 }])
    expect(after.payments[1]).toBe(other)
  })
})
