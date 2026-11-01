// Which payments pay a row: explicit assignments and deposit use (built on domain computeMoney), for the owner-change
// question (Keep / Unassign), bulk edits and rule apply.
import { computeMoney, countedPayments, depositPaidOf, paidOf } from '../domain/amounts'
import type { Ledger, Payment, Rupiah } from '../domain/types'

/** Ids of rows something pays (an explicit assignment or a deposit). */
export function paidRowIds(ledger: Pick<Ledger, 'transactions' | 'payments'>): Set<string> {
  const state = computeMoney(ledger)
  return new Set(ledger.transactions.filter((t) => paidOf(state, t.id) > 0).map((t) => t.id))
}

export interface RowCover {
  /** Payments with an explicit assignment to the row. */
  explicit: Payment[]
  /** Deposits paying the row, per payment, in the order the deposits are applied. */
  deposit: { paymentId: string; amount: Rupiah }[]
}

const strip = (p: Payment): Payment => {
  const { depositOwnerId: _d, ...rest } = p
  return rest
}

/**
 * What pays one row. Deposit use per payment comes from applying the deposits one more at a time, in the same
 * (payment-date) order computeMoney uses: each deposit's share is what the row gains when that deposit is added.
 */
export function rowCover(ledger: Pick<Ledger, 'transactions' | 'payments'>, txId: string): RowCover {
  const explicit = ledger.payments.filter((p) => p.allocations.some((a) => a.txId === txId && a.amount > 0))
  const deposit: RowCover['deposit'] = []
  if (depositPaidOf(computeMoney(ledger), txId) > 0) {
    const order = countedPayments(ledger.payments)
      .filter((p) => p.depositOwnerId !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date))
    let before = 0
    for (let k = 1; k <= order.length; k++) {
      const on = new Set(order.slice(0, k).map((p) => p.id))
      const payments = ledger.payments.map((p) => (p.depositOwnerId === undefined || on.has(p.id) ? p : strip(p)))
      const now = depositPaidOf(computeMoney({ transactions: ledger.transactions, payments }), txId)
      if (now > before) deposit.push({ paymentId: order[k - 1].id, amount: now - before })
      before = now
    }
  }
  return { explicit, deposit }
}

export const isCovered = (c: RowCover) => c.explicit.length > 0 || c.deposit.length > 0

/** What happens to the payments on a row whose owner changes (X-05 / X-06). */
export type PaymentChoice = 'keep' | 'unassign'

/**
 * The payments after the owner of a covered row changes (owner and source set by the caller):
 * - `keep`: explicit assignments stay; what a deposit paid on the row becomes an explicit assignment on that
 *   payment, so the row stays paid (a deposit only pays its own owner's charges).
 * - `unassign`: explicit assignments to the row are removed (back to that payment's To assign or deposit), and the
 *   deposit stops paying it.
 * Returns every payment, changed ones replaced, plus the changed ones.
 */
export function paymentsAfterOwnerChange(
  ledger: Pick<Ledger, 'transactions' | 'payments'>,
  txId: string,
  choice: PaymentChoice,
): { payments: Payment[]; changed: Payment[] } {
  const cover = rowCover(ledger, txId)
  const changed: Payment[] = []
  const payments = ledger.payments.map((p) => {
    if (choice === 'unassign') {
      if (!cover.explicit.includes(p)) return p
      const next = { ...p, allocations: p.allocations.filter((a) => a.txId !== txId) }
      changed.push(next)
      return next
    }
    const share = cover.deposit.find((d) => d.paymentId === p.id)
    if (!share) return p
    // TODO(phase-2): inter-owner debt. Keep leaves the payer's money on the new owner's charge; nothing records
    // that the new owner owes the payer.
    const mine = p.allocations.find((a) => a.txId === txId)
    const allocations = mine
      ? p.allocations.map((a) => (a === mine ? { ...a, amount: a.amount + share.amount } : a))
      : [...p.allocations, { txId, amount: share.amount }]
    const next = { ...p, allocations }
    changed.push(next)
    return next
  })
  return { payments, changed }
}
