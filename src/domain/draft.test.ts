import { describe, expect, it } from 'vitest'
import { billed, ledger, months, pay, tx, unbilled } from '../../test/domain/builders'
import { MoneyError } from './money'
import { acceptSign, draftIssues, signIsAccepted } from './draft'
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
    expect(draftIssues(l, 'oct')).toEqual({
      checkRows: [],
      wrongSignRows: [],
      blockingPayments: [],
      missingPayments: [],
      possibleDuplicatePayments: [],
      notOnStatementRows: [],
      notOnStatementPayments: [],
      count: 0,
      final: true,
    })
  })

  it('Q2 a missing hand payment blocks only statements due on/after it: not a back-filled Jun statement, but Sep and later', () => {
    const l = { ...base(), statements: [billed('jun', '2026-06-12', '2026-06-28'), ...base().statements], payments: [pay('h', '2026-09-20', 100000)] }
    expect(draftIssues(l, 'oct').missingPayments).toEqual(['h'])
    expect(draftIssues(l, 'sep').missingPayments).toEqual(['h'])
    expect(draftIssues(l, 'unb').missingPayments).toEqual(['h'])
    expect(draftIssues(l, 'aug').missingPayments).toEqual([])
    expect(draftIssues(l, 'jun')).toMatchObject({ missingPayments: [], final: true })
    const dueDay = { ...l, payments: [pay('h', '2026-09-28', 100000)] }
    expect(draftIssues(dueDay, 'sep').missingPayments).toEqual(['h'])
  })

  it('M-D-41 draft issues only look at the statement\'s own card', () => {
    const l = {
      ...base(),
      statements: [...base().statements, billed('m-oct', '2026-10-11', '2026-10-31', 'm')],
      transactions: [tx('mc', 'm-oct', '2026-10-01', 1, 'a', { cardId: 'm', check: true }), tx('mg', 'm-unb', '2026-10-01', 1, 'a', { cardId: 'm' })],
      payments: [pay('mp', '2026-10-08', 5, { cardId: 'm' }), pay('ml', '2026-10-02', 5, { cardId: 'm', source: 'statement', statementId: 'm-oct' }), pay('cp', '2026-09-05', 5)],
    }
    expect(draftIssues(l, 'oct')).toMatchObject({ checkRows: [], blockingPayments: [], missingPayments: ['cp'], notOnStatementRows: [], count: 1 })
    expect(draftIssues(l, 'm-oct')).toMatchObject({ checkRows: ['mc'], blockingPayments: ['mp', 'ml'], missingPayments: [], notOnStatementRows: ['mg'], count: 4 })
  })

  it('M-D-42 a row whose sign contradicts its kind keeps the statement Draft', () => {
    const l = { ...base(), transactions: [tx('posRefund', 'oct', '2026-10-01', 44631, 'a', { kind: 'refund' }), tx('negBuy', 'oct', '2026-10-02', -9000, 'a', { kind: 'purchase' }), tx('ok', 'oct', '2026-10-02', -5, 'a')] }
    expect(draftIssues(l, 'oct')).toMatchObject({ wrongSignRows: ['posRefund', 'negBuy'], count: 2, final: false })
  })

  it('F-10 a negative fee or interest (a rebate) accepted as valid no longer keeps the statement Draft', () => {
    const fee = tx('rebate', 'oct', '2026-10-12', -15000, 'a', { kind: 'fee' })
    const interest = tx('bunga', 'oct', '2026-10-12', -1, 'a', { kind: 'interest' })
    const l = { ...base(), transactions: [fee, interest] }
    expect(draftIssues(l, 'oct')).toMatchObject({ wrongSignRows: ['rebate', 'bunga'], count: 2, final: false })
    const accepted = { ...l, transactions: [acceptSign(fee), acceptSign(interest)] }
    expect(accepted.transactions).toEqual([{ ...fee, signAccepted: true }, { ...interest, signAccepted: true }])
    expect(draftIssues(accepted, 'oct')).toMatchObject({ wrongSignRows: [], count: 0, final: true })
    // The original row is not changed.
    expect(fee.signAccepted).toBeUndefined()
  })

  it('F-10 only a negative fee or interest can be accepted; a stale or false flag does not hide a wrong sign', () => {
    for (const t of [
      tx('posFee', 'oct', '2026-10-12', 15000, 'a', { kind: 'fee' }),
      tx('zeroFee', 'oct', '2026-10-12', 0, 'a', { kind: 'interest' }),
      tx('negBuy', 'oct', '2026-10-12', -9000, 'a', { kind: 'purchase' }),
      tx('posRefund', 'oct', '2026-10-12', 9000, 'a', { kind: 'refund' }),
      tx('negInst', 'oct', '2026-10-12', -9000, 'a', { kind: 'installment' }),
    ]) {
      expect(() => acceptSign(t)).toThrow(MoneyError)
      expect(() => acceptSign(t)).toThrow(`transaction ${t.id} is not a negative fee or interest row`)
      expect(signIsAccepted({ ...t, signAccepted: true })).toBe(false)
    }
    const stale = [
      tx('negBuy', 'oct', '2026-10-12', -9000, 'a', { kind: 'purchase', signAccepted: true }),
      tx('notYet', 'oct', '2026-10-12', -500, 'a', { kind: 'fee', signAccepted: false }),
    ]
    expect(draftIssues({ ...base(), transactions: stale }, 'oct').wrongSignRows).toEqual(['negBuy', 'notYet'])
    expect(signIsAccepted(stale[1])).toBe(false)
    expect(signIsAccepted({ ...stale[1], signAccepted: true })).toBe(true)
  })

  it('M-D-43 a possible duplicate hand payment is listed (not as blocking) on statements due on/after it', () => {
    const l = {
      ...base(),
      payments: [pay('line', '2026-09-30', 1900000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 't', amount: 1900000 }] }), pay('hand', '2026-09-28', 1900000)],
    }
    expect(draftIssues(l, 'oct')).toMatchObject({ possibleDuplicatePayments: ['hand'], blockingPayments: [], missingPayments: [], count: 1 })
    expect(draftIssues(l, 'aug').possibleDuplicatePayments).toEqual([])
  })

  it.todo('Q6 (phase 2) Fill oldest first should not offer a charge fully netted by a refund for the same merchant')

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
