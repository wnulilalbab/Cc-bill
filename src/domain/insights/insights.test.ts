import { describe, expect, it } from 'vitest'
import { billed, BCA_FILES, fixtureLedger, ledger, tx, unbilled } from '../../../test/domain/builders'
import { barWidth, MIN_BAR, spendTrend, statementInsights, TOP_MERCHANTS, TREND_STATEMENTS } from './insights'

describe('barWidth', () => {
  it('N-01 is the share of the largest bar in percent, at least MIN_BAR, 0 for nothing positive', () => {
    expect(MIN_BAR).toBe(3)
    expect(barWidth(500, 1000)).toBe(50)
    expect(barWidth(1000, 1000)).toBe(100)
    expect(barWidth(1, 1000)).toBe(3) // tiny but visible
    expect(barWidth(29, 1000)).toBe(3)
    expect(barWidth(31, 1000)).toBe(3)
    expect(barWidth(36, 1000)).toBe(4) // rounded
    expect(barWidth(334, 1000)).toBe(33)
    expect(barWidth(335, 1000)).toBe(34)
    expect(barWidth(0, 1000)).toBe(0)
    expect(barWidth(-5, 1000)).toBe(0)
    expect(barWidth(5, 0)).toBe(0)
    expect(barWidth(5, -1)).toBe(0)
  })
})

describe('statementInsights', () => {
  const l = ledger({
    statements: [billed('oct', '2026-10-12', '2026-10-28'), billed('nov', '2026-11-12', '2026-11-28')],
    transactions: [
      tx('g1', 'oct', '2026-10-01', 9000, 'andi', { description: 'GRAB* A-1 JAKARTA PUSATID' }),
      tx('g2', 'oct', '2026-10-02', 21000, 'andi', { description: 'GRAB* B-2 JAKARTA PUSATID' }),
      tx('net', 'oct', '2026-10-03', 186000, 'kel', { description: 'NETFLIX.COM' }),
      tx('cic', 'oct', '2026-10-04', 729367, 'sari', { description: 'CICILAN BCA KE 02 DARI 06, BLIBLI.COM', kind: 'installment' }),
      tx('fee', 'oct', '2026-10-12', 15000, 'kel', { description: 'BIAYA ADM KARTU', kind: 'fee' }),
      tx('int', 'oct', '2026-10-12', 5000, 'kel', { description: 'BUNGA', kind: 'interest' }),
      tx('shp', 'oct', '2026-10-05', 100000, 'sari', { description: 'SHOPEE JAKARTA' }),
      tx('ref', 'oct', '2026-10-06', -44631, 'sari', { description: 'REFUND SHOPEE JAKARTA', kind: 'refund' }),
      tx('ref2', 'oct', '2026-10-06', -50000, null, { description: 'REFUND ZARA', kind: 'refund' }),
      tx('moved', 'oct', '2026-10-07', 4376200, 'sari', { description: 'BLIBLI.COM', cancelled: true }),
      tx('rev', 'oct', '2026-10-08', -4376200, 'sari', { description: 'REVERSAL CICILAN BLIBLI.COM', kind: 'reversal' }),
      tx('nov1', 'nov', '2026-11-01', 77000, 'andi', { description: 'GRAB* C-3' }),
    ],
  })

  it('N-02 adds up charges minus refunds; cancelled purchases and reversals count 0; other statements are left out', () => {
    const s = statementInsights(l, 'oct')
    const charges = 9000 + 21000 + 186000 + 729367 + 15000 + 5000 + 100000
    expect(s.charges).toBe(charges)
    expect(s.refunds).toBe(44631 + 50000)
    expect(s.spent).toBe(charges - 44631 - 50000)
    expect(s.rows).toBe(9)
  })

  it('N-02 per owner, largest first, no-owner kept (net negative gets no bar)', () => {
    const s = statementInsights(l, 'oct')
    expect(s.byOwner).toEqual([
      { key: 'sari', amount: 729367 + 100000 - 44631, rows: 3, width: 100 },
      { key: 'kel', amount: 186000 + 15000 + 5000, rows: 3, width: barWidth(206000, 784736) },
      { key: 'andi', amount: 30000, rows: 2, width: barWidth(30000, 784736) },
      { key: null, amount: -50000, rows: 1, width: 0 },
    ])
  })

  it('N-02 per kind in a fixed order, fees and interest together, refunds as a positive amount', () => {
    const s = statementInsights(l, 'oct')
    expect(s.byKind).toEqual([
      { key: 'purchases', amount: 316000, rows: 4, width: barWidth(316000, 729367) },
      { key: 'installments', amount: 729367, rows: 1, width: 100 },
      { key: 'feesInterest', amount: 20000, rows: 2, width: barWidth(20000, 729367) },
      { key: 'refunds', amount: 94631, rows: 2, width: barWidth(94631, 729367) },
    ])
  })

  it('N-03 top merchants by net amount: same merchant grouped, refunds netted, fees left out, nothing net-negative', () => {
    const s = statementInsights(l, 'oct')
    expect(s.topMerchants).toEqual([
      { key: 'BLIBLI', amount: 729367, rows: 1, width: 100 },
      { key: 'NETFLIX', amount: 186000, rows: 1, width: barWidth(186000, 729367) },
      { key: 'SHOPEE', amount: 100000 - 44631, rows: 2, width: barWidth(55369, 729367) },
      { key: 'GRAB', amount: 30000, rows: 2, width: barWidth(30000, 729367) },
    ])
  })

  it('N-03 a merchant whose refund cancels its purchase is left out', () => {
    const net = ledger({
      transactions: [tx('p', 's', '2026-10-01', 100, 'a', { description: 'ZARA' }), tx('r', 's', '2026-10-02', -100, 'a', { description: 'REFUND ZARA', kind: 'refund' })],
    })
    expect(statementInsights(net, 's').topMerchants).toEqual([])
  })

  it(`N-03 keeps at most ${TOP_MERCHANTS} merchants; equal amounts by name`, () => {
    const names = ['FF', 'EE', 'DD', 'CC', 'BB', 'AA', 'GG']
    const many = ledger({ transactions: names.map((n, i) => tx(n, 's', '2026-10-01', i === 6 ? 900 : 100, 'a', { description: n })) })
    const top = statementInsights(many, 's').topMerchants
    expect(TOP_MERCHANTS).toBe(5)
    expect(top.map((b) => b.key)).toEqual(['GG', 'AA', 'BB', 'CC', 'DD'])
  })

  it('N-02 an empty statement has nothing (and kinds without rows are left out)', () => {
    expect(statementInsights(l, 'nope')).toEqual({ spent: 0, charges: 0, refunds: 0, rows: 0, byOwner: [], byKind: [], topMerchants: [] })
    const only = statementInsights(l, 'nov')
    expect(only.byKind.map((k) => k.key)).toEqual(['purchases'])
    expect(only.byOwner).toEqual([{ key: 'andi', amount: 77000, rows: 1, width: 100 }])
  })

  it('N-02 owners with equal amounts are ordered by id', () => {
    const tie = ledger({ transactions: [tx('b', 's', '2026-10-01', 100, 'zed'), tx('a', 's', '2026-10-01', 100, 'amy')] })
    expect(statementInsights(tie, 's').byOwner.map((b) => b.key)).toEqual(['amy', 'zed'])
  })

  it('N-02 on the synthetic BCA Nov statement: charges equal the printed purchases plus fees', () => {
    const nov = BCA_FILES[4]
    const s = statementInsights(fixtureLedger(BCA_FILES, 'bca'), nov.file)
    expect(s.charges).toBe(nov.printed.purchases + nov.printed.feesInterest)
    expect(s.refunds).toBe(0)
  })
})

describe('spendTrend', () => {
  const six = ['05', '06', '07', '08', '09', '10', '11'].map((m) => billed(m, `2026-${m}-12`, `2026-${m}-28`))
  const l = ledger({
    statements: [...six, unbilled(), billed('other', '2026-11-12', '2026-11-28', 'x')],
    transactions: [
      ...six.map((s, i) => tx(`t${s.id}`, s.id, s.statementDate, (i + 1) * 1000, 'a')),
      tx('rev', '10', '2026-10-01', -500, 'a', { kind: 'reversal' }),
      tx('ref', '10', '2026-10-01', -1000, 'a', { kind: 'refund' }),
      tx('u', 'unb', '2026-11-20', 99999, 'a'),
    ],
  })

  it(`N-04 the last ${TREND_STATEMENTS} billed statements of the card, oldest first; Unbilled and other cards left out`, () => {
    expect(TREND_STATEMENTS).toBe(6)
    const t = spendTrend(l, 'c')
    expect(t.map((p) => p.statementId)).toEqual(['06', '07', '08', '09', '10', '11'])
    expect(t.map((p) => p.spent)).toEqual([2000, 3000, 4000, 5000, 5000, 7000])
    expect(t[0]).toEqual({ statementId: '06', statementDate: '2026-06-12', spent: 2000, width: barWidth(2000, 7000) })
    expect(t[5].width).toBe(100)
  })

  it('N-04 ends at the selected billed statement; Unbilled or an unknown id means the latest', () => {
    expect(spendTrend(l, 'c', '08').map((p) => p.statementId)).toEqual(['05', '06', '07', '08'])
    expect(spendTrend(l, 'c', '08', 2).map((p) => p.statementId)).toEqual(['07', '08'])
    expect(spendTrend(l, 'c', 'unb').map((p) => p.statementId)).toEqual(['06', '07', '08', '09', '10', '11'])
    expect(spendTrend(l, 'c', 'nope', 1).map((p) => p.statementId)).toEqual(['11'])
  })

  it('N-04 a card without statements has no trend; a month with only refunds gets no bar', () => {
    expect(spendTrend(l, 'none')).toEqual([])
    const neg = ledger({ statements: [billed('a', '2026-10-12', '2026-10-28')], transactions: [tx('r', 'a', '2026-10-01', -100, 'x', { kind: 'refund' })] })
    expect(spendTrend(neg, 'c')).toEqual([{ statementId: 'a', statementDate: '2026-10-12', spent: -100, width: 0 }])
  })
})
