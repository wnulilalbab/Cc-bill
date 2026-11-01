import { countedPayments, depositLeftOf, depositUsedOf, unassignedOf, type MoneyState } from './amounts'
import { couldMatch, MATCH_WINDOW_DAYS } from './matching'
import { daysBetween } from './money'
import { billedOf, previousBilled } from './statements'
import type { Ledger, Owner, Payment, Rupiah, Statement, Transaction } from './types'

/** A statement that should show a payment, closed at least this many days after it (same as the matching window). */
export const MISSING_GRACE_DAYS = MATCH_WINDOW_DAYS

export type BankStatus =
  | { kind: 'onStatement'; statementId: string }
  | { kind: 'unbilled'; statementId: string }
  | { kind: 'linked'; statementId: string }
  | { kind: 'missing'; statementId: string }
  | { kind: 'waiting'; statementId: string }
  /** A bank line with the same amount within ±5 days exists but already has its own assignments: maybe the same money twice. */
  | { kind: 'possibleDuplicate'; lineId: string }
  | { kind: 'pending' }

/** Where the bank shows a payment. Hand-recorded payments become `missing` once a statement dated ≥5 days later doesn't show them;
 * `possibleDuplicate` when an already-assigned bank line could be the same money (unless kept waiting). */
export function bankStatus(ledger: Pick<Ledger, 'statements' | 'payments'>, p: Payment): BankStatus {
  if (p.source === 'statement') return { kind: 'onStatement', statementId: p.statementId! }
  if (p.source === 'unbilled') return { kind: 'unbilled', statementId: p.statementId! }
  const line = ledger.payments.find((x) => x.source !== 'manual' && x.id === p.linkedStatementLine)
  if (line) return { kind: 'linked', statementId: line.statementId! }
  if (!p.waiting) {
    const linkedIds = new Set(ledger.payments.filter((x) => x.source === 'manual').map((x) => x.linkedStatementLine))
    const twin = ledger.payments.find(
      (x) => x.source !== 'manual' && !linkedIds.has(x.id) && (x.allocations.length > 0 || x.depositOwnerId !== undefined) && couldMatch(p, x),
    )
    if (twin) return { kind: 'possibleDuplicate', lineId: twin.id }
  }
  const next = billedOf(ledger, p.cardId).find((s) => daysBetween(p.date, s.statementDate) >= MISSING_GRACE_DAYS)
  if (!next) return { kind: 'pending' }
  return { kind: p.waiting ? 'waiting' : 'missing', statementId: next.id }
}

/** Statement (or Unbilled bucket) a payment is printed on, if any. */
export function printedOn(ledger: Pick<Ledger, 'statements' | 'payments'>, p: Payment): string | undefined {
  const st = bankStatus(ledger, p)
  return st.kind === 'onStatement' || st.kind === 'unbilled' || st.kind === 'linked' ? st.statementId : undefined
}

/** Bank amounts and dates are read-only; so is a hand-recorded payment once matched to a bank line (the bank is the truth). */
export function canEditAmountAndDate(p: Payment): boolean {
  return p.source === 'manual' && !p.linkedStatementLine
}

/**
 * A payment blocks statement `s` (keeps it Draft) when it is not fully assigned and its leftover is not a deposit, and either
 * it is printed on `s`, or it is hand-recorded and dated after the previous statement and on/before `s`'s due date.
 */
export function blocks(ledger: Pick<Ledger, 'statements' | 'payments'>, p: Payment, s: Statement): boolean {
  if (p.cardId !== s.cardId || unassignedOf(p) <= 0 || p.depositOwnerId !== undefined) return false
  if (printedOn(ledger, p) === s.id) return true
  if (p.source !== 'manual' || s.kind !== 'billed') return false
  const prev = previousBilled(ledger, s)
  return p.date <= s.dueDate && (!prev || p.date > prev.statementDate)
}

export type AllocStatus =
  | { kind: 'full' }
  | { kind: 'deposit'; ownerId: string; used: Rupiah; left: Rupiah }
  | { kind: 'none'; left: Rupiah }
  | { kind: 'partial'; left: Rupiah }

export function allocStatus(state: MoneyState, p: Payment): AllocStatus {
  const left = unassignedOf(p)
  if (left <= 0) return { kind: 'full' }
  if (p.depositOwnerId !== undefined) return { kind: 'deposit', ownerId: p.depositOwnerId, used: depositUsedOf(state, p), left: depositLeftOf(state, p) }
  return p.allocations.some((a) => a.amount > 0) ? { kind: 'partial', left } : { kind: 'none', left }
}

export type PaymentTab = 'toAssign' | 'recordedNotOnStatement' | 'done'

/** Payments tab section. `null` for a bank line merged into a hand-recorded payment (shown through that one). */
export function paymentTab(ledger: Pick<Ledger, 'statements' | 'payments'>, p: Payment): PaymentTab | null {
  if (!countedPayments(ledger.payments).includes(p)) return null
  const status = bankStatus(ledger, p).kind
  if (status === 'missing' || status === 'possibleDuplicate') return 'recordedNotOnStatement'
  if (unassignedOf(p) > 0 && p.depositOwnerId === undefined) return 'toAssign'
  return 'done'
}

/** "Keep waiting": the payment stays, shows "Still waiting" and no longer blocks as missing. */
export function keepWaiting(p: Payment): Payment {
  return { ...p, waiting: true }
}

/**
 * "Paid to another card": moves a hand-recorded payment to `targetCardId`. Assignments and deposit are cleared;
 * the people it was for are mapped by name onto the target card's owners.
 */
export function moveToCard(p: Payment, targetCardId: string, transactions: readonly Transaction[], owners: readonly Owner[]): Payment {
  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name
  const was = new Set<string>(p.forOwnerIds ?? [])
  for (const a of p.allocations) {
    const owner = transactions.find((t) => t.id === a.txId)?.ownerId
    if (owner) was.add(owner)
  }
  if (p.depositOwnerId !== undefined) was.add(p.depositOwnerId)
  const names = [...was].map(nameOf)
  const forOwnerIds = owners.filter((o) => o.cardId === targetCardId && names.includes(o.name)).map((o) => o.id)
  const { depositOwnerId: _d, linkedStatementLine: _l, ...rest } = p
  return { ...rest, cardId: targetCardId, allocations: [], forOwnerIds, waiting: true }
}

/** "Transfer failed, delete". */
export function deletePayment(payments: readonly Payment[], paymentId: string): Payment[] {
  return payments.filter((p) => p.id !== paymentId)
}

/** Deletes a row; payments that covered it get that amount back to assign. */
export function deleteTransaction(ledger: Pick<Ledger, 'transactions' | 'payments'>, txId: string): Pick<Ledger, 'transactions' | 'payments'> {
  return {
    transactions: ledger.transactions.filter((t) => t.id !== txId),
    payments: ledger.payments.map((p) =>
      p.allocations.some((a) => a.txId === txId) ? { ...p, allocations: p.allocations.filter((a) => a.txId !== txId) } : p,
    ),
  }
}

/** "Keep waiting" on an Unbilled row older than the latest statement. */
export function keepWaitingRow(tx: Transaction): Transaction {
  return { ...tx, keepWaiting: true }
}
