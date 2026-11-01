// AI rows → statement rows in the money core's terms: signed integer rupiah (credits negative), a kind for every
// row, credit lines classified (payment / refund / reversal), installment numbers parsed.
import type { AiRow } from '../ai/schema'
import { parseInstallment } from '../domain/installments'
import { classifyCredit, type CreditKind } from '../domain/matching'
import type { StatementRow } from '../domain/reconcile'
import type { TxKind } from '../domain/types'

/** `unknownCredit`: a credit line the app could not classify; the user picks payment or refund before saving. */
export type RowKind = TxKind | 'payment' | 'unknownCredit'

export interface DraftRow {
  /** Stable key within the import. */
  key: string
  page: number
  date: string
  postDate: string
  description: string
  /** Signed integer rupiah: charges > 0, credits < 0. */
  amount: number
  kind: RowKind
  installment?: { n: number; of: number }
}

const INTEREST = /\b(BUNGA|INTEREST|FINANCE CHARGE)\b/i
const FEE = /\b(BIAYA|BEA METERAI|METERAI|IURAN|ANNUAL FEE|LATE FEE|LATE CHARGE|DENDA|FEE)\b/i

/** Kind of a charge line (not a credit). */
export function chargeKind(description: string): TxKind {
  if (parseInstallment(description)) return 'installment'
  if (INTEREST.test(description)) return 'interest'
  if (FEE.test(description)) return 'fee'
  return 'purchase'
}

export function creditKind(description: string): CreditKind | 'unknownCredit' {
  return classifyCredit(description) ?? 'unknownCredit'
}

export function normalizeRow(r: AiRow, key: string): DraftRow {
  const kind: RowKind = r.credit ? creditKind(r.description) : chargeKind(r.description)
  const row: DraftRow = { key, page: r.page, date: r.date, postDate: r.postDate, description: r.description, amount: r.credit ? -r.amount : r.amount, kind }
  const inst = kind === 'installment' ? parseInstallment(r.description) : null
  if (inst) row.installment = inst
  return row
}

export function normalizeRows(rows: readonly AiRow[]): DraftRow[] {
  return rows.map((r, i) => normalizeRow(r, `r${i}`))
}

/** Rows for the totals check. An unclassified credit counts as a credit (its sign already says so). */
export function statementRows(rows: readonly DraftRow[]): StatementRow[] {
  return rows.map((r) => ({ amount: r.amount, kind: r.kind === 'unknownCredit' ? 'refund' : r.kind }))
}

/** Same merchant text, ignoring case, spacing and punctuation. */
export function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const [x, y] = [n(a), n(b)]
  return x === y || (Math.min(x.length, y.length) >= 8 && (x.startsWith(y) || y.startsWith(x)))
}

/** Identity of a row for duplicate and overlap checks: same day, same amount, same merchant text. */
export const rowIdentity = (r: { date: string; amount: number; description: string }) =>
  `${r.date}|${r.amount}|${r.description.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
