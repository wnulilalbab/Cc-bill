import { assertRupiah, MoneyError, sum } from './money'
import type { Ledger, Payment, Rupiah, Transaction } from './types'

/** What a row counts for: cancelled purchases and reversals count 0; refunds stay negative. */
export function effective(tx: Transaction): Rupiah {
  assertRupiah(tx.amount, `transaction ${tx.id} amount`)
  return tx.cancelled || tx.kind === 'reversal' ? 0 : tx.amount
}

/**
 * Payments counted in the money: a bank line that a hand-recorded payment was matched to
 * is the same money, so only the hand-recorded one (which carries the assignments) counts.
 */
export function countedPayments(payments: readonly Payment[]): Payment[] {
  const linked = new Set(payments.filter((p) => p.source === 'manual' && p.linkedStatementLine).map((p) => p.linkedStatementLine))
  return payments.filter((p) => p.source === 'manual' || !linked.has(p.id))
}

function checkPayment(p: Payment): void {
  assertRupiah(p.amount, `payment ${p.id} amount`)
  if (p.amount <= 0) throw new MoneyError(`payment ${p.id} amount must be positive, got ${p.amount}`)
  for (const a of p.allocations) {
    assertRupiah(a.amount, `payment ${p.id} allocation to ${a.txId}`)
    if (a.amount < 0) throw new MoneyError(`payment ${p.id} allocation to ${a.txId} is negative`)
  }
}

/** Sum of the explicit assignments of a payment. */
export function allocatedOf(p: Payment): Rupiah {
  checkPayment(p)
  return sum(p.allocations.map((a) => a.amount))
}

/** Payment amount not explicitly assigned (negative when over-assigned). */
export function unassignedOf(p: Payment): Rupiah {
  return p.amount - allocatedOf(p)
}

export interface MoneyState {
  /** Explicitly assigned per transaction id. */
  explicit: Map<string, Rupiah>
  /** Paid from a deposit per transaction id. */
  fromDeposit: Map<string, Rupiah>
  /** Deposit used per payment id. */
  depositUsed: Map<string, Rupiah>
  /** The counted payments this state was built from (without the excluded one). */
  payments: Payment[]
}

const add = (m: Map<string, Rupiah>, k: string, v: Rupiah) => m.set(k, (m.get(k) ?? 0) + v)
const byDate = <T extends { date: string }>(list: T[]) => list.slice().sort((a, b) => a.date.localeCompare(b.date))

/**
 * Explicit payments plus the deposit flow. A deposit (a payment's unassigned leftover kept for an owner)
 * pays that owner's charges on the same card dated on/after the payment date, oldest first, deposits applied
 * in payment-date order, and never pays what explicit assignments already cover.
 * `excludePaymentId` leaves one payment out entirely (used while editing that payment).
 */
export function computeMoney(ledger: Pick<Ledger, 'transactions' | 'payments'>, excludePaymentId?: string): MoneyState {
  const explicit = new Map<string, Rupiah>()
  const fromDeposit = new Map<string, Rupiah>()
  const depositUsed = new Map<string, Rupiah>()
  const active = countedPayments(ledger.payments).filter((p) => p.id !== excludePaymentId)
  for (const p of active) {
    checkPayment(p)
    for (const a of p.allocations) add(explicit, a.txId, a.amount)
  }

  for (const p of byDate(active.filter((x) => x.depositOwnerId !== undefined))) {
    let left = unassignedOf(p)
    let used = 0
    const charges = byDate(
      ledger.transactions.filter((t) => t.cardId === p.cardId && t.ownerId === p.depositOwnerId && t.date >= p.date && effective(t) > 0),
    )
    for (const t of charges) {
      const open = effective(t) - (explicit.get(t.id) ?? 0) - (fromDeposit.get(t.id) ?? 0)
      const take = Math.min(open, left)
      if (take > 0) {
        add(fromDeposit, t.id, take)
        left -= take
        used += take
      }
    }
    depositUsed.set(p.id, used)
  }
  return { explicit, fromDeposit, depositUsed, payments: active }
}

export function explicitPaidOf(state: MoneyState, txId: string): Rupiah {
  return state.explicit.get(txId) ?? 0
}

export function depositPaidOf(state: MoneyState, txId: string): Rupiah {
  return state.fromDeposit.get(txId) ?? 0
}

export function paidOf(state: MoneyState, txId: string): Rupiah {
  return explicitPaidOf(state, txId) + depositPaidOf(state, txId)
}

/** Still to pay on a row. Refunds return their negative amount; not-counted rows return 0. */
export function remainingOf(state: MoneyState, tx: Transaction): Rupiah {
  const e = effective(tx)
  if (e <= 0) return e
  return Math.max(0, e - paidOf(state, tx.id))
}

export type TxStatus = 'notCounted' | 'refund' | 'paid' | 'partial' | 'unpaid'

export function txStatus(state: MoneyState, tx: Transaction): TxStatus {
  const e = effective(tx)
  if (tx.cancelled || tx.kind === 'reversal') return 'notCounted'
  if (e < 0) return 'refund'
  if (remainingOf(state, tx) === 0) return 'paid'
  return paidOf(state, tx.id) > 0 ? 'partial' : 'unpaid'
}

export function depositUsedOf(state: MoneyState, p: Payment): Rupiah {
  return state.depositUsed.get(p.id) ?? 0
}

/** Unused deposit of a payment (0 when its leftover is not kept as a deposit). */
export function depositLeftOf(state: MoneyState, p: Payment): Rupiah {
  if (p.depositOwnerId === undefined) return 0
  return Math.max(0, unassignedOf(p)) - depositUsedOf(state, p)
}

/** "Deposit waiting" of an owner: unused deposit across the counted payments of the state. */
export function ownerDepositLeft(state: MoneyState, ownerId: string | null): Rupiah {
  return sum(state.payments.filter((p) => p.depositOwnerId === ownerId).map((p) => depositLeftOf(state, p)))
}
