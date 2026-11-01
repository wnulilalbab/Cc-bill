import { describe, expect, it } from 'vitest'
import { ledger, months, pay, tx, unbilled } from '../../test/domain/builders'
import { draftIssues } from './draft'
import { keepWaiting, keepWaitingRow } from './payments'

const base = () => ledger({ statements: [...months(), unbilled('m-unb', 'm')] })

describe('Draft / Final', () => {
  it('F-01 four Check rows on S make it Draft', () => {
    const l = { ...base(), transactions: ['a', 'b', 'c', 'd'].map((id) => tx(id, 'oct', '2026-10-01', 1000, 'sari', { check: true })).concat([tx('e', 'oct', '2026-10-01', 1, 'sari'), tx('f', 'sep', '2026-09-01', 1, 'sari', { check: true })]) }
    const d = draftIssues(l, 'oct')
    expect(d.checkRows).toEqual(['a', 'b', 'c', 'd'])
    expect(d.count).toBe(4)
    expect(d.final).toBe(false)
  })

  it('F-02 an unassigned bank payment printed on S makes it Draft and points at that payment', () => {
    const l = { ...base(), payments: [pay('line', '2026-09-27', 1470000, { source: 'statement', statementId: 'oct' })] }
    expect(draftIssues(l, 'oct')).toMatchObject({ blockingPayments: ['line'], count: 1, final: false })
    expect(draftIssues(l, 'sep').blockingPayments).toEqual([])
  })

  it('F-03 an unassigned Unbilled payment line dated after S does not block S', () => {
    const l = { ...base(), payments: [pay('u', '2026-10-20', 2000000, { source: 'unbilled', statementId: 'unb' })] }
    expect(draftIssues(l, 'oct')).toMatchObject({ blockingPayments: [], notOnStatementPayments: [], final: true })
    expect(draftIssues(l, 'unb').blockingPayments).toEqual(['u'])
  })

  it('F-04 an unassigned hand payment between S−1\'s date and S\'s due date blocks S', () => {
    const l = { ...base(), payments: [pay('h', '2026-10-25', 500000)] }
    expect(draftIssues(l, 'oct')).toMatchObject({ blockingPayments: ['h'], missingPayments: [], count: 1 })
    expect(draftIssues(l, 'sep').blockingPayments).toEqual([])
  })

  it('F-05 a payment whose leftover is kept as a deposit does not block', () => {
    const l = { ...base(), payments: [pay('line', '2026-09-27', 1470000, { source: 'statement', statementId: 'oct', depositOwnerId: 'sari' })] }
    expect(draftIssues(l, 'oct').final).toBe(true)
  })

  it('F-06 a payment whose leftover is left to "Decide later" blocks', () => {
    const l = { ...base(), payments: [pay('line', '2026-09-27', 1470000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 't', amount: 1000000 }] })] }
    expect(draftIssues(l, 'oct').blockingPayments).toEqual(['line'])
  })

  it('F-07 a hand payment missing from the next statement blocks, listed once as missing', () => {
    const l = { ...base(), payments: [pay('bima', '2026-09-05', 300000)] }
    const d = draftIssues(l, 'sep')
    expect(d.missingPayments).toEqual(['bima'])
    expect(d.blockingPayments).toEqual([])
    expect(d.count).toBe(1)
    expect(draftIssues(l, 'oct').missingPayments).toEqual(['bima'])
    expect(draftIssues({ ...l, payments: [{ ...l.payments[0], cardId: 'm' }] }, 'sep').missingPayments).toEqual([])
  })

  it('P-15 a missing payment kept waiting no longer blocks as missing', () => {
    const l = { ...base(), payments: [keepWaiting(pay('bima', '2026-09-05', 300000, { allocations: [{ txId: 't', amount: 300000 }] }))] }
    expect(draftIssues(l, 'sep')).toMatchObject({ missingPayments: [], blockingPayments: [], final: true })
  })

  it('F-08 an Unbilled row dated before the latest statement that it did not contain blocks the latest statement only', () => {
    const l = {
      ...base(),
      transactions: [
        tx('ghost', 'unb', '2026-10-09', 27000, 'andi'),
        tx('fresh', 'unb', '2026-10-12', 9000, 'andi'),
        tx('elsewhere', 'm-unb', '2026-10-01', 1, 'andi', { cardId: 'm' }),
      ],
      payments: [
        pay('ghostPay', '2026-10-11', 5000, { source: 'unbilled', statementId: 'unb', depositOwnerId: 'andi' }),
        pay('freshPay', '2026-10-12', 5000, { source: 'unbilled', statementId: 'unb', depositOwnerId: 'andi' }),
      ],
    }
    expect(draftIssues(l, 'oct')).toMatchObject({ notOnStatementRows: ['ghost'], notOnStatementPayments: ['ghostPay'], count: 2, final: false })
    expect(draftIssues(l, 'sep')).toMatchObject({ notOnStatementRows: [], notOnStatementPayments: [], final: true })
    expect(draftIssues(l, 'unb').notOnStatementRows).toEqual([])
  })

  it('I-10 Keep waiting on a flagged Unbilled row (or payment line) resolves it', () => {
    const l = {
      ...base(),
      transactions: [keepWaitingRow(tx('ghost', 'unb', '2026-10-09', 27000, 'andi'))],
      payments: [keepWaiting(pay('ghostPay', '2026-10-11', 5000, { source: 'unbilled', statementId: 'unb', depositOwnerId: 'andi' }))],
    }
    expect(draftIssues(l, 'oct').final).toBe(true)
  })

  it('F-09 with everything resolved the statement is Final', () => {
    const l = {
      ...base(),
      transactions: [tx('t', 'oct', '2026-10-01', 1470000, 'sari')],
      payments: [pay('line', '2026-09-27', 1470000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 't', amount: 1470000 }] })],
    }
    expect(draftIssues(l, 'oct')).toEqual({ checkRows: [], blockingPayments: [], missingPayments: [], notOnStatementRows: [], notOnStatementPayments: [], count: 0, final: true })
  })

  it('M-D-40 a card with no billed statement only checks rows and payments; unknown statements throw', () => {
    const l = ledger({ statements: [unbilled()], transactions: [tx('u', 'unb', '2026-10-01', 1, 'a', { check: true })] })
    expect(draftIssues(l, 'unb')).toMatchObject({ checkRows: ['u'], notOnStatementRows: [], count: 1 })
    expect(() => draftIssues(l, 'nope')).toThrow('unknown statement nope')
  })

  it('P-13 a bank line matched to a hand payment is not listed twice', () => {
    const l = { ...base(), payments: [pay('line', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct' }), pay('hand', '2026-09-28', 1900000, { linkedStatementLine: 'line' })] }
    expect(draftIssues(l, 'oct').blockingPayments).toEqual(['hand'])
  })
})
