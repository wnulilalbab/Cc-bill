// What the Bill screen and the person detail show (docs/intent/phase-1.md §8). Pure functions over the domain
// (ownerBill / cardBill / coverageOf), so every number on screen comes from the money core and the lines add up.
import { computeMoney, depositLeftOf, depositUsedOf, unassignedOf, type MoneyState } from '../../domain/amounts'
import { cardBill, coverageOf, type BillLine, type OwnerBill } from '../../domain/bill'
import { sum } from '../../domain/money'
import type { ISODate, Ledger, Payment, Rupiah, Statement } from '../../domain/types'
import { MONTHS } from '../transactions/view'

/** Totals for the whole card on the selected statement: the sum of the owners' bills. */
export interface Hero {
  /** To pay for this bill: the sum of the owners' must-pay (the card tile total, M-09). */
  total: Rupiah
  /** This statement's charges (refunds reduce them). */
  charges: Rupiah
  alreadyPaid: Rupiah
  /** Left on this statement's own charges: charges − already paid. */
  left: Rupiah
  olderRemaining: Rupiah
  /** Owners whose refunds are larger than their charges: their credit is not taken off anyone else's bill. */
  credit: Rupiah
  depositWaiting: Rupiah
  installmentsToCome: Rupiah
  /** Nothing open for anyone. */
  settled: boolean
}

export interface BillView {
  statement: Statement
  hero: Hero
  /** Every owner bill of the card (domain cardBill). */
  owners: OwnerBill[]
  /** The owners listed under "By person": something on this bill, older, a credit or a deposit waiting. */
  shown: OwnerBill[]
}

/** True when an owner has anything to show on this bill. */
export const hasSomething = (b: OwnerBill) => b.lines.length > 0 || b.older.length > 0 || b.credit > 0 || b.depositWaiting > 0

export function billView(ledger: Ledger, ownerIds: readonly string[], statementId: string, today: ISODate): BillView {
  const statement = ledger.statements.find((s) => s.id === statementId)!
  const cb = cardBill(ledger, ownerIds, statementId, today)
  const of = (f: (b: OwnerBill) => Rupiah) => sum(cb.owners.map(f))
  const charges = of((b) => b.charges)
  const alreadyPaid = of((b) => b.alreadyPaid)
  const hero: Hero = {
    total: cb.total,
    charges,
    alreadyPaid,
    left: charges - alreadyPaid,
    olderRemaining: of((b) => b.olderRemaining),
    credit: of((b) => b.credit),
    depositWaiting: of((b) => b.depositWaiting),
    installmentsToCome: of((b) => b.installmentsToComeTotal),
    settled: cb.owners.every((b) => b.settled),
  }
  return { statement, hero, owners: cb.owners, shown: cb.owners.filter(hasSomething) }
}

/** "Oct 2026" / "Unbilled". */
export const monthName = (s: Statement) => (s.kind === 'unbilled' ? 'Unbilled' : `${MONTHS[Number(s.statementDate.slice(5, 7)) - 1]} ${s.statementDate.slice(0, 4)}`)

/** "Oct" (short, for "Unpaid from Sep, Aug"). */
export const shortMonth = (s: Statement) => (s.kind === 'unbilled' ? 'Unbilled' : MONTHS[Number(s.statementDate.slice(5, 7)) - 1])

export type KindGroup = 'purchase' | 'installment' | 'feeInterest' | 'refund' | 'notCounted'

export const KIND_GROUP_LABEL: Record<KindGroup, string> = {
  purchase: 'Purchases',
  installment: 'Installments',
  feeInterest: 'Fees and interest',
  refund: 'Refunds',
  notCounted: 'Not counted',
}

const ORDER: KindGroup[] = ['purchase', 'installment', 'feeInterest', 'refund', 'notCounted']

export function kindGroupOf(l: BillLine): KindGroup {
  if (l.status === 'notCounted') return 'notCounted'
  const k = l.tx.kind
  if (k === 'fee' || k === 'interest') return 'feeInterest'
  if (k === 'installment') return 'installment'
  if (k === 'refund') return 'refund'
  return 'purchase'
}

export interface LineGroup {
  kind: KindGroup
  lines: BillLine[]
  /** Counted amount of the group (refunds negative, not-counted rows 0). */
  total: Rupiah
  paid: Rupiah
}

/** This statement's lines grouped by kind, each group by date. Group totals add up to the owner's charges. */
export function groupByKind(lines: readonly BillLine[]): LineGroup[] {
  return ORDER.map((kind) => {
    const list = lines.filter((l) => kindGroupOf(l) === kind).sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.tx.id.localeCompare(b.tx.id))
    return { kind, lines: list, total: sum(list.map((l) => l.effective)), paid: sum(list.map(paidPart)) }
  }).filter((g) => g.lines.length > 0)
}

/** What of a line is paid (0 for refunds and not-counted rows): effective − remaining. */
export const paidPart = (l: BillLine): Rupiah => (l.effective > 0 ? l.effective - l.remaining : 0)

export interface PaymentShare {
  payment: Payment
  /** Of this payment, what pays the owner's lines on this statement. */
  amount: Rupiah
  /** Paid after this statement's due date. */
  afterDue: boolean
}

export interface DepositView {
  payment: Payment
  /** The payment's leftover kept as the deposit. */
  amount: Rupiah
  used: Rupiah
  left: Rupiah
}

export interface PersonPayments {
  /** Explicit payments on this statement's lines, oldest first. */
  payments: PaymentShare[]
  /** Paid from deposits on this statement's lines. */
  fromDeposit: Rupiah
  /** Deposits of this owner on the card (from any payment), oldest first. */
  deposits: DepositView[]
}

/**
 * The payments behind an owner's "Already paid" on this statement (domain coverageOf per line), plus the owner's
 * deposits. sum(payments) + fromDeposit = the owner's alreadyPaid.
 */
export function personPayments(ledger: Ledger, bill: OwnerBill, state: MoneyState = computeMoney(ledger)): PersonPayments {
  const shares = new Map<string, PaymentShare>()
  let fromDeposit = 0
  for (const l of bill.lines) {
    if (l.effective <= 0) continue
    const c = coverageOf(ledger, l.tx.id, state)
    // A payment can't pay more than the row (paid = min(effective, assigned + deposit)); explicit first.
    let room = l.effective
    for (const p of c.payments) {
      const take = Math.min(p.amount, room)
      room -= take
      const payment = state.payments.find((x) => x.id === p.paymentId)!
      const s = shares.get(p.paymentId) ?? { payment, amount: 0, afterDue: p.afterDue }
      s.amount += take
      shares.set(p.paymentId, s)
    }
    fromDeposit += Math.min(c.fromDeposit, room)
  }
  const deposits = state.payments
    .filter((p) => p.depositOwnerId !== undefined && p.depositOwnerId === bill.ownerId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ payment: p, amount: Math.max(0, unassignedOf(p)), used: depositUsedOf(state, p), left: depositLeftOf(state, p) }))
  const payments = [...shares.values()].filter((s) => s.amount > 0).sort((a, b) => a.payment.date.localeCompare(b.payment.date))
  return { payments, fromDeposit, deposits }
}
