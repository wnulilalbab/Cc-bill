// Insights preview (docs/intent/phase-1.md: "Insights tab ships as a preview only"). Pure functions over the ledger:
// what a statement's rows add up to, per person, per kind and per merchant, and the spend of the last statements.
// Rows count with their effective amount (src/domain/amounts): cancelled purchases and reversals count 0, refunds
// are negative. Payments are not spending and are never read here.
import { effective } from '../amounts'
import { sum } from '../money'
import { billedOf } from '../statements'
import { normalizeMerchant } from '../tagging/merchant'
import type { ISODate, Ledger, Rupiah, Transaction, TxKind } from '../types'

/** One bar of a chart: `width` is the bar length in percent of the largest bar (0 for nothing positive). */
export interface Bar<K extends string | null = string> {
  key: K
  amount: Rupiah
  /** Counted rows behind the amount. */
  rows: number
  width: number
}

export type KindGroup = 'purchases' | 'installments' | 'feesInterest' | 'refunds'

export interface StatementInsights {
  /** Charges minus refunds: what the statement's rows add up to. */
  spent: Rupiah
  /** Sum of the positive rows. */
  charges: Rupiah
  /** Sum of the refunds, as a positive number. */
  refunds: Rupiah
  /** Rows that count (effective amount not 0). */
  rows: number
  /** Per owner (null = no owner), largest first. */
  byOwner: Bar<string | null>[]
  /** Purchases, installments, fees and interest; refunds as a positive amount. Only groups with rows. */
  byKind: Bar<KindGroup>[]
  /** Merchants by net amount, largest first, at most `TOP_MERCHANTS`; only merchants with a positive net amount. */
  topMerchants: Bar[]
}

export interface TrendPoint {
  statementId: string
  statementDate: ISODate
  spent: Rupiah
  width: number
}

export const TOP_MERCHANTS = 5
export const TREND_STATEMENTS = 6
/** The shortest bar drawn for a positive amount, so a small one stays visible (prototype: 3%). */
export const MIN_BAR = 3

/** Bar length in percent of `max`: at least MIN_BAR for a positive amount, 0 for nothing positive. */
export function barWidth(amount: Rupiah, max: Rupiah): number {
  if (amount <= 0 || max <= 0) return 0
  return Math.max(MIN_BAR, Math.round((amount / max) * 100))
}

const KIND_GROUP: Record<Exclude<TxKind, 'reversal'>, KindGroup> = {
  purchase: 'purchases',
  installment: 'installments',
  fee: 'feesInterest',
  interest: 'feesInterest',
  refund: 'refunds',
}
const KIND_ORDER: readonly KindGroup[] = ['purchases', 'installments', 'feesInterest', 'refunds']

function bars<K extends string | null>(groups: Map<K, { amount: Rupiah; rows: number }>): Bar<K>[] {
  const list = [...groups].map(([key, g]) => ({ key, amount: g.amount, rows: g.rows }))
  const max = Math.max(0, ...list.map((b) => b.amount))
  return list.map((b) => ({ ...b, width: barWidth(b.amount, max) }))
}

function addTo<K>(m: Map<K, { amount: Rupiah; rows: number }>, key: K, amount: Rupiah): void {
  const g = m.get(key) ?? { amount: 0, rows: 0 }
  m.set(key, { amount: g.amount + amount, rows: g.rows + 1 })
}

const largestFirst = <K extends string | null>(a: Bar<K>, b: Bar<K>) => b.amount - a.amount || String(a.key).localeCompare(String(b.key))

/** The rows of one statement (or Unbilled) that count, with their effective amount. */
function counted(ledger: Pick<Ledger, 'transactions'>, statementId: string): { tx: Transaction; amount: Rupiah }[] {
  return ledger.transactions
    .filter((t) => t.statementId === statementId)
    .map((tx) => ({ tx, amount: effective(tx) }))
    .filter((r) => r.amount !== 0)
}

/** What one statement's rows add up to, per person, per kind and per merchant. */
export function statementInsights(ledger: Pick<Ledger, 'transactions'>, statementId: string): StatementInsights {
  const rows = counted(ledger, statementId)
  const byOwner = new Map<string | null, { amount: Rupiah; rows: number }>()
  const byKind = new Map<KindGroup, { amount: Rupiah; rows: number }>()
  const byMerchant = new Map<string, { amount: Rupiah; rows: number }>()
  for (const { tx, amount } of rows) {
    addTo(byOwner, tx.ownerId, amount)
    addTo(byKind, KIND_GROUP[tx.kind as Exclude<TxKind, 'reversal'>], Math.abs(amount)) // a reversal counts 0, so never here
    if (tx.kind !== 'fee' && tx.kind !== 'interest') addTo(byMerchant, normalizeMerchant(tx.description), amount)
  }
  const kinds = new Map(KIND_ORDER.filter((k) => byKind.has(k)).map((k) => [k, byKind.get(k)!]))
  const merchants = new Map([...byMerchant].filter(([, g]) => g.amount > 0))
  const spent = sum(rows.map((r) => r.amount))
  const charges = sum(rows.map((r) => Math.max(0, r.amount)))
  return {
    spent,
    charges,
    refunds: charges - spent,
    rows: rows.length,
    byOwner: bars(byOwner).sort(largestFirst),
    byKind: bars(kinds),
    topMerchants: bars(merchants).sort(largestFirst).slice(0, TOP_MERCHANTS),
  }
}

/**
 * Spend of the card's billed statements, oldest first: the last `count` up to and including `upTo` (a billed
 * statement id; any other id, e.g. Unbilled, means up to the latest).
 */
export function spendTrend(ledger: Pick<Ledger, 'statements' | 'transactions'>, cardId: string, upTo?: string, count = TREND_STATEMENTS): TrendPoint[] {
  const all = billedOf(ledger, cardId)
  const end = all.findIndex((s) => s.id === upTo)
  const shown = all.slice(0, end === -1 ? all.length : end + 1).slice(-count)
  const points = shown.map((s) => ({ statementId: s.id, statementDate: s.statementDate, spent: sum(counted(ledger, s.id).map((r) => r.amount)) }))
  const max = Math.max(0, ...points.map((p) => p.spent))
  return points.map((p) => ({ ...p, width: barWidth(p.spent, max) }))
}
