import { assertRupiah, MoneyError, signContradicts, sum } from './money'
import { statementById } from './statements'
import type { Ledger, PrintedTotals, Rupiah, TxKind } from './types'

/** A printed statement row: signed as printed (credits negative). */
export interface StatementRow {
  amount: Rupiah
  kind: TxKind | 'payment'
}

export interface Reconciliation {
  ok: boolean
  /** computed new balance − printed new balance (0 when ok). */
  difference: Rupiah
  computed: { credits: Rupiah; purchases: Rupiah; feesInterest: Rupiah; newBalance: Rupiah }
  /** Indexes of rows whose sign contradicts their kind (a positive credit or a negative charge). */
  wrongSign: number[]
}

const CREDIT = new Set(['payment', 'refund', 'reversal'])
const PURCHASE = new Set(['purchase', 'installment'])

/** Totals check: previous − credits + purchases + fees/interest vs the printed new balance. */
export function reconcile(printed: PrintedTotals, rows: readonly StatementRow[]): Reconciliation {
  for (const r of rows) assertRupiah(r.amount, 'row amount')
  assertRupiah(printed.prevBalance, 'previous balance')
  assertRupiah(printed.newBalance, 'new balance')
  const total = (pick: (r: StatementRow) => boolean) => sum(rows.filter(pick).map((r) => r.amount))
  const credits = 0 - total((r) => CREDIT.has(r.kind)) // 0 − x, never −0
  const purchases = total((r) => PURCHASE.has(r.kind))
  const feesInterest = total((r) => r.kind === 'fee' || r.kind === 'interest')
  const newBalance = printed.prevBalance - credits + purchases + feesInterest
  const difference = newBalance - printed.newBalance
  const wrongSign = rows.flatMap((r, i) => (signContradicts(r.kind, r.amount) ? [i] : []))
  return { ok: difference === 0, difference, computed: { credits, purchases, feesInterest, newBalance }, wrongSign }
}

/**
 * Totals check for a billed statement in the ledger: every row printed on it (cancelled purchases and reversals
 * included, as the bank prints them) and every bank payment line printed on it.
 */
export function reconcileStatement(ledger: Ledger, statementId: string): Reconciliation {
  const s = statementById(ledger, statementId)
  if (!s || s.kind !== 'billed') throw new MoneyError(`not a billed statement: ${statementId}`)
  const rows: StatementRow[] = [
    ...ledger.transactions.filter((t) => t.statementId === s.id).map((t) => ({ amount: t.amount, kind: t.kind })),
    ...ledger.payments.filter((p) => p.source === 'statement' && p.statementId === s.id).map((p) => ({ amount: -p.amount, kind: 'payment' as const })),
  ]
  return reconcile(s.printed, rows)
}
