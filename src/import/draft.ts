// An import being reviewed: the rows read from the file, the printed totals, the questions the user must answer.
// Nothing here touches the database; editing helpers return a new draft.
import type { AiTotals } from '../ai/schema'
import { reconcile, type Reconciliation } from '../domain/reconcile'
import type { PrintedTotals } from '../domain/types'
import { rowIdentity, statementRows, type DraftRow } from './normalize'

export type ImportTarget = 'statement' | 'unbilled'
export type ImportFormat = 'pdf' | 'screenshots'

export interface DuplicateQuestion {
  rowKey: string
  /** The stored transaction or payment line this row looks like. */
  existingId: string
  /** Where the stored one is, e.g. "Unbilled" or "the 2026-10-12 statement". */
  where: string
  decision?: 'keep' | 'skip'
}

export interface ImportDraft {
  cardId: string
  target: ImportTarget
  format: ImportFormat
  fileNames: string[]
  /** SHA-256 of the file(s): the AI cache key and the "already imported" check. */
  fileHash: string
  /** The AI answer came from the cache (no API call). */
  fromCache: boolean
  statementDate: string | null
  dueDate: string | null
  /** Totals as the AI read them. */
  printed: AiTotals
  /** Screenshot statements: the bank's total, typed by the user. Required for them. */
  typedTotal: number | null
  rows: DraftRow[]
  /** Lines seen on two overlapping screenshots, counted once. */
  overlapMerged: number
  duplicates: DuplicateQuestion[]
  /** This exact file was imported before. */
  alreadyImported?: { at: string; statementId: string }
  /** PDFs: previous and new balance read on the device from the printed text, to cross-check the AI (prompt injection guard). */
  deviceTotals?: { prevBalance: number | null; newBalance: number | null }
  /** Things worth a look that do not block saving (e.g. the file name and the printed month disagree). */
  warnings: string[]
  /** Statement imports: a statement for the same month already exists and will be replaced. */
  replaces?: { statementId: string; statementDate: string }
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/** Rows the user chose to skip as duplicates. */
export function skippedKeys(d: ImportDraft): Set<string> {
  return new Set(d.duplicates.filter((q) => q.decision === 'skip').map((q) => q.rowKey))
}

/**
 * Printed totals for the statement. Screenshot statements carry only the previous balance and the total, so the
 * typed total is the new balance and the middle figures are the rows' own. Null while something is missing.
 */
export function printedOf(d: ImportDraft): PrintedTotals | null {
  const newBalance = d.format === 'screenshots' ? d.typedTotal : d.printed.newBalance
  if (newBalance === null || d.printed.prevBalance === null) return null
  const computed = reconcile({ prevBalance: 0, credits: 0, purchases: 0, feesInterest: 0, newBalance: 0 }, statementRows(d.rows)).computed
  const pick = (k: 'credits' | 'purchases' | 'feesInterest') => (d.format === 'pdf' ? d.printed[k] : null) ?? computed[k]
  const printed: PrintedTotals = {
    prevBalance: d.printed.prevBalance,
    credits: pick('credits'),
    purchases: pick('purchases'),
    feesInterest: pick('feesInterest'),
    newBalance,
  }
  if (d.printed.minPayment !== null) printed.minPayment = d.printed.minPayment
  return printed
}

/**
 * Printed figures the AI reported differently from what the device read in the same text. While any is open the
 * totals check is never shown as matching, and the import cannot be saved.
 */
export function totalsConflicts(d: ImportDraft): { field: 'prevBalance' | 'newBalance'; ai: number | null; printed: number }[] {
  if (d.target !== 'statement' || !d.deviceTotals) return []
  return (['prevBalance', 'newBalance'] as const).flatMap((field) => {
    const printed = d.deviceTotals![field]
    return printed !== null && d.printed[field] !== printed ? [{ field, ai: d.printed[field], printed }] : []
  })
}

/** The totals check (statements only): previous − credits + charges = printed new balance. */
export function checkTotals(d: ImportDraft): Reconciliation | null {
  const printed = d.target === 'statement' ? printedOf(d) : null
  return printed ? reconcile(printed, statementRows(d.rows)) : null
}

/** What still has to be answered before the import can be saved (empty = ready). */
export function problems(d: ImportDraft): string[] {
  const out: string[] = []
  if (d.target === 'statement') {
    if (!d.statementDate) out.push('Pick the statement date.')
    if (!d.dueDate) out.push('Pick the due date.')
    if (d.format === 'screenshots' && d.typedTotal === null) out.push("Type the bank's total from the first screenshot.")
    else if (d.printed.newBalance === null && d.format === 'pdf') out.push("Type the statement's new balance.")
    if (d.printed.prevBalance === null) out.push("Type the statement's previous balance.")
  } else if (d.rows.length === 0) out.push('No transactions were found on these screenshots.')
  for (const c of totalsConflicts(d))
    out.push(`The ${c.field === 'newBalance' ? 'new balance' : 'previous balance'} read by the AI (${c.ai ?? 'none'}) is not the one printed on the statement (${c.printed}). Use the printed figure.`)
  const unknown = d.rows.filter((r) => r.kind === 'unknownCredit').length
  if (unknown) out.push(`Say what ${unknown === 1 ? '1 credit line is' : `${unknown} credit lines are`}: a payment or a refund.`)
  const open = d.duplicates.filter((q) => !q.decision).length
  if (open) out.push(`Answer ${open === 1 ? 'the duplicate question' : `${open} duplicate questions`}: keep both or skip.`)
  return out
}

const replaceRow = (d: ImportDraft, key: string, patch: Partial<DraftRow>): ImportDraft => {
  if (!d.rows.some((r) => r.key === key)) throw new ImportError(`No row ${key} in this import.`)
  return { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }
}

/** Fix a misread amount (signed rupiah, as the row shows it). The totals check re-runs from the new draft. */
export function setRowAmount(d: ImportDraft, key: string, amount: number): ImportDraft {
  if (!Number.isSafeInteger(amount)) throw new ImportError('An amount must be a whole number of rupiah.')
  return replaceRow(d, key, { amount })
}

/** The user's answer for a credit line the app could not classify. */
export function setCreditKind(d: ImportDraft, key: string, kind: 'payment' | 'refund'): ImportDraft {
  const row = d.rows.find((r) => r.key === key)
  if (!row || row.amount > 0) throw new ImportError('Only a credit line can be a payment or a refund.')
  return replaceRow(d, key, { kind })
}

export function decideDuplicate(d: ImportDraft, rowKey: string, decision: 'keep' | 'skip'): ImportDraft {
  if (!d.duplicates.some((q) => q.rowKey === rowKey)) throw new ImportError('There is no duplicate question for this row.')
  return { ...d, duplicates: d.duplicates.map((q) => (q.rowKey === rowKey ? { ...q, decision } : q)) }
}

export function setTypedTotal(d: ImportDraft, total: number | null): ImportDraft {
  if (total !== null && (!Number.isSafeInteger(total) || total < 0)) throw new ImportError("The bank's total must be a whole number of rupiah.")
  return { ...d, typedTotal: total }
}

export function setDates(d: ImportDraft, dates: { statementDate?: string | null; dueDate?: string | null }): ImportDraft {
  return { ...d, ...dates }
}

export function setPrinted(d: ImportDraft, patch: Partial<AiTotals>): ImportDraft {
  return { ...d, printed: { ...d.printed, ...patch } }
}

/**
 * Screenshots that overlap (scrolling the same list twice) show the same lines again. A line counts as many times as
 * it appears on any single screenshot: twice on one screenshot = two purchases; once on each of two = one purchase.
 */
export function mergeOverlaps(rows: readonly DraftRow[]): { rows: DraftRow[]; merged: number } {
  const perPage = new Map<string, Map<number, number>>()
  for (const r of rows) {
    const id = `${r.kind}|${rowIdentity(r)}`
    const pages = perPage.get(id) ?? new Map<number, number>()
    pages.set(r.page, (pages.get(r.page) ?? 0) + 1)
    perPage.set(id, pages)
  }
  const left = new Map([...perPage].map(([id, pages]) => [id, Math.max(...pages.values())]))
  const kept = rows.filter((r) => {
    const id = `${r.kind}|${rowIdentity(r)}`
    const n = left.get(id)!
    left.set(id, n - 1)
    return n > 0
  })
  return { rows: kept, merged: rows.length - kept.length }
}
