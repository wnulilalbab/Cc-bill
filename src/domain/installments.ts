import { effective, explicitPaidOf, computeMoney } from './amounts'
import { monthIndex, sum } from './money'
import { latestBilled, statementById } from './statements'
import type { Allocation, InstallmentPlan, ISODate, Ledger, Payment, Statement, Transaction } from './types'

/** Installment number from a statement line: "CICILAN BCA KE 01 DARI 06, …" or "… 002/003". */
export function parseInstallment(description: string): { n: number; of: number } | null {
  const bca = /\bKE\s+(\d{1,3})\s+DARI\s+(\d{1,3})\b/i.exec(description)
  const slash = /\b(\d{3})\/(\d{3})\s*$/.exec(description)
  const m = bca ?? slash
  if (!m) return null
  const n = Number(m[1])
  const of = Number(m[2])
  return n >= 1 && n <= of ? { n, of } : null
}

/** `REVERSAL CICILAN BCA BLIBLI.COM *121` → merchant `BLIBLI.COM`, ref `121`. */
export function parseInstallmentReversal(description: string): { merchant: string; ref: string } | null {
  const m = /^\s*REVERSAL\s+CICILAN\s+(?:BCA\s+)?(.+?)\s*\*\s*(\S+)/i.exec(description)
  return m ? { merchant: m[1].toUpperCase(), ref: m[2].toUpperCase() } : null
}

/**
 * Months still to come after the selected statement — a snapshot as of that statement.
 * For the Unbilled view the reference is the latest billed statement, or `today` when the card has none.
 */
export function monthsLeft(plan: InstallmentPlan, s: Statement, ledger: Pick<Ledger, 'statements'>, today: ISODate): number {
  const ref = s.kind === 'billed' ? s.statementDate : (latestBilled(ledger, s.cardId)?.statementDate ?? today)
  const index = monthIndex(ref) - monthIndex(plan.start) + 1
  if (index < 1) return plan.total
  return Math.max(0, plan.total - index)
}

export interface ConversionResult {
  originalId: string
  reversalId: string
  installmentId: string
  /** Updated rows: original (cancelled), reversal (reverses), installment 1/N (owner, plan). */
  transactions: Transaction[]
  /** Payments whose assignments changed. */
  payments: Payment[]
  plan: InstallmentPlan
  /** Payment ids whose excess could not become the owner's deposit (already a deposit for someone else). */
  conflicts: string[]
}

export type ConversionError = 'notAReversal' | 'originalNotFound' | 'installmentNotFound'

/**
 * Installment conversion. A `REVERSAL CICILAN … *<ref>` credit cancels the earlier purchase with the same
 * amount whose description carries `*<ref>`; explicit assignments on that purchase move to installment 1/N
 * of the same merchant (capped at what is open on it), any excess becomes the purchase owner's deposit.
 * `planId` is the id to use if the installment is not linked to a plan yet.
 */
export function convertToInstallment(
  ledger: Ledger,
  reversalId: string,
  planId: string,
): ConversionResult | { error: ConversionError } {
  const reversal = ledger.transactions.find((t) => t.id === reversalId)
  const parsed = reversal && reversal.kind === 'reversal' ? parseInstallmentReversal(reversal.description) : null
  if (!reversal || !parsed) return { error: 'notAReversal' }

  const original = ledger.transactions
    .filter(
      (t) =>
        t.cardId === reversal.cardId &&
        t.kind === 'purchase' &&
        t.amount === -reversal.amount &&
        t.date <= reversal.date &&
        t.description.toUpperCase().includes(`*${parsed.ref}`),
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!original) return { error: 'originalNotFound' }

  const installment = ledger.transactions
    .filter(
      (t) =>
        t.cardId === reversal.cardId &&
        t.kind === 'installment' &&
        t.date >= original.date &&
        (t.installment ?? parseInstallment(t.description))?.n === 1 &&
        t.description.toUpperCase().includes(parsed.merchant),
    )
    .sort((a, b) => Number(b.statementId === reversal.statementId) - Number(a.statementId === reversal.statementId))[0]
  if (!installment) return { error: 'installmentNotFound' }

  const ownerId = original.ownerId
  const of = (installment.installment ?? parseInstallment(installment.description))!.of
  const existingPlan = ledger.plans.find((p) => p.id === installment.planId)
  const stmt = statementById(ledger, installment.statementId)
  const plan: InstallmentPlan = existingPlan ?? {
    id: planId,
    cardId: installment.cardId,
    ownerId,
    name: original.description,
    monthly: installment.amount,
    total: of,
    start: (stmt?.kind === 'billed' ? stmt.statementDate : installment.date).slice(0, 7),
  }

  // Room left on the installment after every explicit assignment it already has.
  const moving = ledger.payments.filter((p) => p.allocations.some((a) => a.txId === original.id))
  let room = Math.max(0, effective(installment) - explicitPaidOf(computeMoney(ledger), installment.id))

  const conflicts: string[] = []
  const payments = moving
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const onOriginal = sum(p.allocations.filter((a) => a.txId === original.id).map((a) => a.amount))
      const onInstallment = sum(p.allocations.filter((a) => a.txId === installment.id).map((a) => a.amount))
      const move = Math.min(onOriginal, room)
      room -= move
      const allocations: Allocation[] = p.allocations.filter((a) => a.txId !== original.id && a.txId !== installment.id)
      if (onInstallment + move > 0) allocations.push({ txId: installment.id, amount: onInstallment + move })
      const next: Payment = { ...p, allocations }
      if (move < onOriginal) {
        if (p.depositOwnerId === undefined && ownerId !== null) next.depositOwnerId = ownerId
        else if (p.depositOwnerId !== ownerId) conflicts.push(p.id)
      }
      return next
    })

  return {
    originalId: original.id,
    reversalId: reversal.id,
    installmentId: installment.id,
    transactions: [
      { ...original, cancelled: true },
      { ...reversal, reverses: original.id, ownerId },
      { ...installment, ownerId, planId: plan.id, check: false },
    ],
    payments,
    plan,
    conflicts,
  }
}
