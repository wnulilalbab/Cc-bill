import { describe, expect, it } from 'vitest'
import corruptOct from '../../test/fixtures/statements/bca-2026-10-corrupt.expected.json'
import empty from '../../test/fixtures/statements/bca-2026-12-empty.expected.json'
import mandiri08 from '../../test/fixtures/screenshots/mandiri-2026-08.expected.json'
import mandiri09 from '../../test/fixtures/screenshots/mandiri-2026-09.expected.json'
import { BCA_FILES, fixtureLedger, ledger, MANDIRI_FILES, pay, tx, billed } from '../../test/domain/builders'
import { MoneyError } from './money'
import { reconcile, reconcileStatement, type StatementRow } from './reconcile'
import type { PrintedTotals } from './types'

const rows = (e: { rows: { amount: number; kind: string }[] }) => e.rows.map((r) => ({ amount: r.amount, kind: r.kind }) as StatementRow)

describe('totals check', () => {
  it('I-01 every synthetic statement reconciles with its printed totals', () => {
    for (const e of [...BCA_FILES, ...MANDIRI_FILES, mandiri08, mandiri09, empty]) {
      const r = reconcile(e.printed, rows(e))
      expect(r, e.file).toEqual({
        ok: true,
        difference: 0,
        computed: { credits: e.printed.credits, purchases: e.printed.purchases, feesInterest: e.printed.feesInterest, newBalance: e.printed.newBalance },
      })
    }
  })

  it('I-02 one amount off by 1 reports a mismatch of exactly Rp 1; fixing the row matches again', () => {
    const r = reconcile(corruptOct.printed, rows(corruptOct))
    expect(r.ok).toBe(false)
    expect(r.difference).toBe(1)
    expect(r.computed.purchases - corruptOct.printed.purchases).toBe(1)
    const fixed = rows(corruptOct).map((x) => (x.amount === 245001 ? { ...x, amount: 245000 } : x))
    expect(reconcile(corruptOct.printed, fixed)).toMatchObject({ ok: true, difference: 0 })
  })

  it('M-D-70 previous − credits + purchases + fees/interest, signed', () => {
    const printed: PrintedTotals = { prevBalance: 1000, credits: 0, purchases: 0, feesInterest: 0, newBalance: 1430 }
    const r = reconcile(printed, [
      { amount: -300, kind: 'payment' },
      { amount: -20, kind: 'refund' },
      { amount: -50, kind: 'reversal' },
      { amount: 500, kind: 'purchase' },
      { amount: 200, kind: 'installment' },
      { amount: 60, kind: 'fee' },
      { amount: 40, kind: 'interest' },
    ])
    expect(r).toEqual({ ok: true, difference: 0, computed: { credits: 370, purchases: 700, feesInterest: 100, newBalance: 1430 } })
    expect(reconcile({ ...printed, newBalance: 1500 }, []).difference).toBe(-500)
    expect(() => reconcile(printed, [{ amount: 0.5, kind: 'purchase' }])).toThrow(MoneyError)
    expect(() => reconcile({ ...printed, prevBalance: 0.5 }, [])).toThrow('previous balance')
    expect(() => reconcile({ ...printed, newBalance: 0.5 }, [])).toThrow('new balance')
  })

  it('M-D-71 a statement in the ledger reconciles from its rows and bank payment lines (cancelled and reversal rows as printed)', () => {
    const l = fixtureLedger(BCA_FILES, 'bca')
    for (const e of BCA_FILES) expect(reconcileStatement(l, e.file), e.file).toMatchObject({ ok: true, difference: 0 })
    // Marking the Sep Blibli purchase as moved to installment does not change what Sep printed.
    const moved = { ...l, transactions: l.transactions.map((t) => (t.description.startsWith('BLIBLI') ? { ...t, cancelled: true } : t)) }
    expect(reconcileStatement(moved, 'bca-2026-09').ok).toBe(true)
    // Hand-recorded and Unbilled payments are not on the statement.
    const extra = { ...l, payments: [...l.payments, pay('h', '2026-10-01', 5, { cardId: 'bca' }), pay('u', '2026-10-01', 5, { cardId: 'bca', source: 'unbilled', statementId: 'bca-2026-10' })] }
    expect(reconcileStatement(extra, 'bca-2026-10').ok).toBe(true)
    expect(() => reconcileStatement(l, 'bca-unb')).toThrow('not a billed statement: bca-unb')
    expect(() => reconcileStatement(l, 'nope')).toThrow(MoneyError)
    const one = ledger({ statements: [billed('s', '2026-10-12', '2026-10-28')], transactions: [tx('t', 's', '2026-10-01', 1, 'a')] })
    expect(reconcileStatement(one, 's')).toMatchObject({ ok: false, difference: 1 })
  })
})
