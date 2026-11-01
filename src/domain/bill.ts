import {
  computeMoney,
  countedPayments,
  depositPaidOf,
  effective,
  ownerDepositLeft,
  paidOf,
  remainingOf,
  txStatus,
  type MoneyState,
  type TxStatus,
} from './amounts'
import { monthsLeft } from './installments'
import { MoneyError, sum } from './money'
import { billedOf, statementById } from './statements'
import type { BilledStatement, Card, ISODate, Ledger, Rupiah, Statement, Transaction } from './types'

export interface BillLine {
  tx: Transaction
  effective: Rupiah
  paid: Rupiah
  fromDeposit: Rupiah
  remaining: Rupiah
  status: TxStatus
}

export interface OlderGroup {
  statement: BilledStatement
  /** Rows still open (charges with something left, refunds that reduce it). */
  lines: BillLine[]
  /** Net still to pay on that statement; negative = a refund credit not used up yet. */
  remaining: Rupiah
}

export interface FutureInstallment {
  planId: string
  monthsLeft: number
  amount: Rupiah
}

export interface OwnerBill {
  ownerId: string | null
  statementId: string
  /** Every row of this owner on the selected statement (not-counted rows included, with effective 0). */
  lines: BillLine[]
  /** This statement's charges (refunds reduce it). */
  charges: Rupiah
  alreadyPaid: Rupiah
  thisRemaining: Rupiah
  /** Older billed statements with a non-zero net, newest first (refund credits carry forward). */
  older: OlderGroup[]
  olderRemaining: Rupiah
  /** Rows in Unbilled (info only, not part of mustPay). Empty when viewing Unbilled. */
  notBilledYet: BillLine[]
  notBilledYetTotal: Rupiah
  /** Snapshot as of the selected statement. */
  installmentsToCome: FutureInstallment[]
  installmentsToComeTotal: Rupiah
  depositWaiting: Rupiah
  /** this remaining + older remaining, never below 0. */
  mustPay: Rupiah
  /** Nothing open: show "Paid ✓", not 0. */
  settled: boolean
}

function line(state: MoneyState, tx: Transaction): BillLine {
  return {
    tx,
    effective: effective(tx),
    paid: paidOf(state, tx.id),
    fromDeposit: depositPaidOf(state, tx.id),
    remaining: remainingOf(state, tx),
    status: txStatus(state, tx),
  }
}

function requireStatement(ledger: Pick<Ledger, 'statements'>, statementId: string): Statement {
  const s = statementById(ledger, statementId)
  if (!s) throw new MoneyError(`unknown statement ${statementId}`)
  return s
}

/**
 * What one owner has to pay for the selected statement (billed or Unbilled), live as of now:
 * paid amounts include every payment recorded so far; installments-to-come are a snapshot at `s`.
 */
export function ownerBill(ledger: Ledger, ownerId: string | null, statementId: string, today: ISODate, state = computeMoney(ledger)): OwnerBill {
  const s = requireStatement(ledger, statementId)
  const mine = ledger.transactions.filter((t) => t.cardId === s.cardId && t.ownerId === ownerId)
  const lines = mine.filter((t) => t.statementId === s.id).map((t) => line(state, t))
  const charges = sum(lines.map((l) => l.effective))
  const thisRemaining = sum(lines.map((l) => l.remaining))

  const older = billedOf(ledger, s.cardId)
    .filter((x) => s.kind === 'unbilled' || x.statementDate < s.statementDate)
    .reverse()
    .map((statement) => {
      const groupLines = mine.filter((t) => t.statementId === statement.id).map((t) => line(state, t)).filter((l) => l.remaining !== 0)
      return { statement, lines: groupLines, remaining: sum(groupLines.map((l) => l.remaining)) }
    })
    .filter((g) => g.remaining !== 0)
  const olderRemaining = sum(older.map((g) => g.remaining))

  const unbilledIds = new Set(ledger.statements.filter((x) => x.cardId === s.cardId && x.kind === 'unbilled').map((x) => x.id))
  const notBilledYet = s.kind === 'unbilled' ? [] : mine.filter((t) => unbilledIds.has(t.statementId)).map((t) => line(state, t))

  const installmentsToCome = ledger.plans
    .filter((p) => p.cardId === s.cardId && p.ownerId === ownerId)
    .map((p) => {
      const left = monthsLeft(p, s, ledger, today)
      return { planId: p.id, monthsLeft: left, amount: left * p.monthly }
    })
    .filter((f) => f.monthsLeft > 0)

  const mustPay = Math.max(0, thisRemaining + olderRemaining)
  return {
    ownerId,
    statementId: s.id,
    lines,
    charges,
    alreadyPaid: charges - thisRemaining,
    thisRemaining,
    older,
    olderRemaining,
    notBilledYet,
    notBilledYetTotal: sum(notBilledYet.map((l) => l.effective)),
    installmentsToCome,
    installmentsToComeTotal: sum(installmentsToCome.map((f) => f.amount)),
    depositWaiting: ownerDepositLeft(state, ownerId),
    mustPay,
    settled: mustPay === 0,
  }
}

export interface CardBill {
  statementId: string
  /** One bill per owner of the card (archived owners included: they keep history), plus `null` for rows without an owner. */
  owners: OwnerBill[]
  /** Card tile total = sum of the owners' must-pay. */
  total: Rupiah
}

export function cardBill(ledger: Ledger, ownerIds: readonly string[], statementId: string, today: ISODate): CardBill {
  const s = requireStatement(ledger, statementId)
  const state = computeMoney(ledger)
  const ids: (string | null)[] = [...ownerIds]
  if (ledger.transactions.some((t) => t.cardId === s.cardId && t.ownerId === null)) ids.push(null)
  const owners = ids.map((id) => ownerBill(ledger, id, s.id, today, state))
  return { statementId: s.id, owners, total: sum(owners.map((o) => o.mustPay)) }
}

export interface Coverage {
  payments: { paymentId: string; date: ISODate; amount: Rupiah; afterDue: boolean }[]
  fromDeposit: Rupiah
}

/** Payments covering a row, with the "after due" marker (payment dated after the row's statement due date). */
export function coverageOf(ledger: Ledger, txId: string, state = computeMoney(ledger)): Coverage {
  const tx = ledger.transactions.find((t) => t.id === txId)
  if (!tx) throw new MoneyError(`unknown transaction ${txId}`)
  const s = statementById(ledger, tx.statementId)
  const due = s?.kind === 'billed' ? s.dueDate : undefined
  const payments = countedPayments(ledger.payments).flatMap((p) =>
    p.allocations
      .filter((a) => a.txId === txId && a.amount > 0)
      .map((a) => ({ paymentId: p.id, date: p.date, amount: a.amount, afterDue: due !== undefined && p.date > due })),
  )
  return { payments, fromDeposit: depositPaidOf(state, txId) }
}

/** Fees and interest go to the card's default owner, without a Check (unless the card has no default owner). */
export function feeOwner(card: Card): { ownerId: string | null; check: boolean } {
  return { ownerId: card.defaultOwnerId, check: card.defaultOwnerId === null }
}
