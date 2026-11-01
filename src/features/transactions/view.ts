// What the Transactions list shows: per-row money status, filters, search, date groups and totals. Pure functions over
// the domain ledger (money from src/domain/amounts), so the screen only renders.
import { computeMoney, effective, paidOf, remainingOf, txStatus, type MoneyState, type TxStatus } from '../../domain/amounts'
import { draftIssues } from '../../domain/draft'
import { sum } from '../../domain/money'
import { latestBilled, statementSortKey } from '../../domain/statements'
import { ruleKeyOf } from '../../domain/tagging/merchant'
import type { Ledger, Rupiah, Statement, TagSource, Transaction, TxKind } from '../../domain/types'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "9.000", "−44.631" (credits negative). */
export const fmt = (n: Rupiah) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('id-ID')}`

/** "16 Oct 2026". */
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** "Fri 16 Oct 2026" (date group heading). */
export function dayHeading(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${dayLabel(iso)}`
}

/** "Oct 2026 statement" / "Unbilled". */
export const statementName = (s: Statement | undefined) =>
  !s ? 'Statement' : s.kind === 'unbilled' ? 'Unbilled' : `${MONTHS[Number(s.statementDate.slice(5, 7)) - 1]} ${s.statementDate.slice(0, 4)} statement`

/** Statements for the picker: Unbilled first, then billed newest first. */
export const statementsForPicker = (statements: readonly Statement[]) =>
  statements.slice().sort((a, b) => statementSortKey(b).localeCompare(statementSortKey(a)))

/** The statement the screen opens on: the latest billed one, else Unbilled. */
export function defaultStatementId(ledger: Pick<Ledger, 'statements'>, cardId: string): string | undefined {
  return latestBilled(ledger, cardId)?.id ?? ledger.statements.find((s) => s.cardId === cardId)?.id
}

export const TAG_SOURCE_LABEL: Record<TagSource, string> = { manual: 'You', rule: 'Rule', auto: 'Auto', ai: 'AI', default: 'Card default', plan: 'Plan' }

export interface RowView {
  tx: Transaction
  effective: Rupiah
  paid: Rupiah
  remaining: Rupiah
  status: TxStatus
  /** "n of m same day": rows of the card with the same merchant on the same day. */
  sameDay?: { n: number; of: number }
  /** Unbilled row older than the latest statement that the statement did not contain. */
  notOnStatement?: string
}

/** Rows of one statement (or Unbilled), with their money status. */
export function rowViews(ledger: Ledger, statementId: string, state: MoneyState = computeMoney(ledger)): RowView[] {
  const s = ledger.statements.find((x) => x.id === statementId)
  if (!s) return []
  const latest = latestBilled(ledger, s.cardId)
  const card = ledger.transactions.filter((t) => t.cardId === s.cardId)
  const sameKey = (t: Transaction) => `${t.date}|${ruleKeyOf(t.description)}`
  const groups = new Map<string, string[]>()
  for (const t of card.slice().sort((a, b) => a.id.localeCompare(b.id))) groups.set(sameKey(t), [...(groups.get(sameKey(t)) ?? []), t.id])
  return card
    .filter((t) => t.statementId === s.id)
    .map((tx) => {
      const same = groups.get(sameKey(tx))!
      const row: RowView = { tx, effective: effective(tx), paid: paidOf(state, tx.id), remaining: remainingOf(state, tx), status: txStatus(state, tx) }
      if (same.length > 1) row.sameDay = { n: same.indexOf(tx.id) + 1, of: same.length }
      if (s.kind === 'unbilled' && latest && tx.date < latest.statementDate && !tx.keepWaiting) row.notOnStatement = statementName(latest).replace(' statement', '')
      return row
    })
}

export type StatusFilter = 'all' | 'check' | 'open' | 'unpaid' | 'partial' | 'paid'
export type KindFilter = 'all' | 'purchase' | 'installment' | 'feeInterest' | 'refund' | 'reversal' | 'moved'

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All status' },
  { value: 'check', label: 'Needs check' },
  { value: 'open', label: 'Unpaid or partly paid' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partly paid' },
  { value: 'paid', label: 'Paid' },
]

export const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All kinds' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'installment', label: 'Installments' },
  { value: 'feeInterest', label: 'Fees and interest' },
  { value: 'refund', label: 'Refunds' },
  { value: 'reversal', label: 'Reversals' },
  { value: 'moved', label: 'Moved to installment' },
]

export interface Filters {
  /** 'all', 'none' (no owner) or an owner id. */
  owner: string
  status: StatusFilter
  kind: KindFilter
  q: string
}

export const NO_FILTERS: Filters = { owner: 'all', status: 'all', kind: 'all', q: '' }

const KIND_OF: Record<Exclude<KindFilter, 'all' | 'moved' | 'feeInterest'>, TxKind> = {
  purchase: 'purchase',
  installment: 'installment',
  refund: 'refund',
  reversal: 'reversal',
}

function kindMatches(t: Transaction, k: KindFilter): boolean {
  if (k === 'all') return true
  if (k === 'moved') return !!t.cancelled
  if (k === 'feeInterest') return t.kind === 'fee' || t.kind === 'interest'
  return t.kind === KIND_OF[k] && !t.cancelled
}

function statusMatches(r: RowView, s: StatusFilter): boolean {
  if (s === 'all') return true
  if (s === 'check') return !!r.tx.check
  if (s === 'open') return r.status === 'unpaid' || r.status === 'partial'
  return r.status === s
}

/** Search by description, label, owner name or amount ("9000" and "9.000" both match 9.000). */
export function searchMatches(r: RowView, q: string, ownerName = ''): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return true
  const abs = Math.abs(r.tx.amount)
  const hay = [r.tx.description, r.tx.label ?? '', ownerName, String(abs), abs.toLocaleString('id-ID'), ruleKeyOf(r.tx.description)].join(' ').toLowerCase()
  return hay.includes(query)
}

export function applyFilters(rows: readonly RowView[], f: Filters, ownerName: (id: string | null) => string): RowView[] {
  return rows.filter(
    (r) =>
      (f.owner === 'all' || (f.owner === 'none' ? r.tx.ownerId === null : r.tx.ownerId === f.owner)) &&
      statusMatches(r, f.status) &&
      kindMatches(r.tx, f.kind) &&
      searchMatches(r, f.q, ownerName(r.tx.ownerId)),
  )
}

/** Rows grouped by day, newest day first; rows within a day by description. */
export function groupByDate(rows: readonly RowView[]): { date: string; rows: RowView[] }[] {
  const byDay = new Map<string, RowView[]>()
  for (const r of rows) byDay.set(r.tx.date, [...(byDay.get(r.tx.date) ?? []), r])
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, rows: list.sort((a, b) => a.tx.description.localeCompare(b.tx.description) || a.tx.id.localeCompare(b.tx.id)) }))
}

export interface Totals {
  /** Counted amount (refunds reduce it; not-counted rows are 0). */
  total: Rupiah
  paid: Rupiah
  /** total − paid. */
  left: Rupiah
}

export function totalsOf(rows: readonly RowView[]): Totals {
  const total = sum(rows.map((r) => r.effective))
  const paid = sum(rows.map((r) => (r.effective > 0 ? r.effective - r.remaining : 0)))
  return { total, paid, left: total - paid }
}

/** Statements (by name) that are Final in `before` and Draft in `after`, e.g. after a payment is unassigned. */
export function statementsTurningDraft(before: Ledger, after: Ledger): string[] {
  return before.statements
    .filter((s) => draftIssues(before, s.id).final && !draftIssues(after, s.id).final)
    .map((s) => statementName(s).replace(' statement', ''))
}

/** "The Oct 2026 statement goes back to Draft …" or nothing. */
export function draftWarning(names: readonly string[]): string | null {
  if (!names.length) return null
  return `The ${names.join(' and ')} ${names.length === 1 ? 'statement goes' : 'statements go'} back to Draft until the payment is assigned again.`
}

/** Credits (refunds, reversals) are stored negative; charges positive. */
export const signedFor = (kind: TxKind, abs: number) => (kind === 'refund' || kind === 'reversal' ? -abs : abs)
