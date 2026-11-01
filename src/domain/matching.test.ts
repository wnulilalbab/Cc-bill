import { describe, expect, it } from 'vitest'
import { pay } from '../../test/domain/builders'
import { applyLinks, classifyCredit, MATCH_WINDOW_DAYS, matchManualPayments } from './matching'

const line = (id: string, date: string, amount: number, extra = {}) => pay(id, date, amount, { source: 'statement', statementId: 'oct', ...extra })

describe('matching hand-recorded payments to bank lines', () => {
  it('P-13 a 1.900.000 hand payment on 28 Sep links to the 1.900.000 line on 30 Sep, assignments unchanged', () => {
    const hand = pay('hand', '2026-09-28', 1900000, { allocations: [{ txId: 't', amount: 1900000 }], waiting: true })
    const links = matchManualPayments([line('l', '2026-09-30', 1900000), hand])
    expect(links).toEqual([{ paymentId: 'hand', lineId: 'l', days: 2 }])
    const after = applyLinks([line('l', '2026-09-30', 1900000), hand], links)
    expect(after[1]).toEqual({ ...hand, linkedStatementLine: 'l', waiting: false })
    expect(after[0]).toEqual(line('l', '2026-09-30', 1900000))
  })

  it('P-14 a line more than 5 days away, or with another amount or card, is not linked', () => {
    expect(MATCH_WINDOW_DAYS).toBe(5)
    expect(matchManualPayments([line('l', '2026-10-04', 1900000), pay('h', '2026-09-28', 1900000)])).toEqual([])
    expect(matchManualPayments([line('l', '2026-10-03', 1900000), pay('h', '2026-09-28', 1900000)])).toEqual([{ paymentId: 'h', lineId: 'l', days: 5 }])
    expect(matchManualPayments([line('l', '2026-09-23', 1900000), pay('h', '2026-09-28', 1900000)])).toEqual([{ paymentId: 'h', lineId: 'l', days: -5 }])
    expect(matchManualPayments([line('l', '2026-09-22', 1900000), pay('h', '2026-09-28', 1900000)])).toEqual([])
    expect(matchManualPayments([line('l', '2026-09-28', 1900001), pay('h', '2026-09-28', 1900000)])).toEqual([])
    expect(matchManualPayments([line('l', '2026-09-28', 1900000, { cardId: 'm' }), pay('h', '2026-09-28', 1900000)])).toEqual([])
  })

  it('M-D-60 each line and each payment is used once; the closest date wins, then the earlier line', () => {
    const links = matchManualPayments([
      line('far', '2026-10-02', 100),
      line('near', '2026-09-29', 100),
      line('tieLate', '2026-09-30', 200),
      line('tieEarly', '2026-09-26', 200),
      pay('h2', '2026-09-29', 100),
      pay('h1', '2026-09-27', 100),
      pay('h3', '2026-09-28', 100),
      pay('t', '2026-09-28', 200),
    ])
    expect(links).toEqual([
      { paymentId: 'h1', lineId: 'near', days: 2 },
      { paymentId: 'h3', lineId: 'far', days: 4 },
      { paymentId: 't', lineId: 'tieEarly', days: -2 },
    ])
  })

  it('M-D-61 keeps existing links and skips lines that carry their own assignments or deposit', () => {
    const links = matchManualPayments([
      line('taken', '2026-09-28', 100),
      pay('linked', '2026-09-28', 100, { linkedStatementLine: 'taken' }),
      pay('new', '2026-09-28', 100),
      line('assigned', '2026-09-28', 100, { allocations: [{ txId: 't', amount: 100 }] }),
      line('deposit', '2026-09-28', 100, { depositOwnerId: 'sari' }),
      line('unbilled', '2026-09-29', 100, { source: 'unbilled', statementId: 'unb' }),
    ])
    expect(links).toEqual([{ paymentId: 'new', lineId: 'unbilled', days: 1 }])
  })
})

describe('credit line classification', () => {
  it('I-06 PEMBAYARAN → payment, REVERSAL CICILAN → reversal, REFUND → refund', () => {
    expect(classifyCredit('PEMBAYARAN - MBCA')).toBe('payment')
    expect(classifyCredit('PAYMENT THANK YOU - Livin')).toBe('payment')
    expect(classifyCredit('TRANSFER PEMBAYARAN 20/10')).toBe('payment')
    expect(classifyCredit('transfer dari rekening')).toBe('payment')
    expect(classifyCredit('REVERSAL CICILAN BCA BLIBLI.COM *121')).toBe('reversal')
    expect(classifyCredit('REFUND SHOPEE.CO.ID *AP1260721')).toBe('refund')
    expect(classifyCredit('REFUND SHOPEE Jakarta SelatID')).toBe('refund')
    expect(classifyCredit('REVERSAL REFUND X')).toBe('reversal')
    // REVERSAL wins over REFUND wherever the words appear; REFUND wins over payment words.
    expect(classifyCredit('REFUND REVERSAL CICILAN X')).toBe('reversal')
    expect(classifyCredit('REFUND PEMBAYARAN GANDA')).toBe('refund')
    expect(classifyCredit('PAYMENT REVERSAL')).toBe('reversal')
    expect(classifyCredit('CASHBACK PROMO')).toBeNull()
    expect(classifyCredit('PAYMENTS')).toBeNull()
  })
})
