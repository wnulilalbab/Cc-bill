import { countedPayments } from './amounts'
import { canAcceptSign, MoneyError, signContradicts } from './money'
import { bankStatus, blocks } from './payments'
import { latestBilled, statementById } from './statements'
import type { Ledger, Transaction } from './types'

export interface DraftIssues {
  /** 1. Rows on the statement with Check. */
  checkRows: string[]
  /**
   * 1b. Rows on the statement whose sign contradicts their kind (e.g. a positive refund): must be checked and fixed,
   * or, for a negative fee or interest (a rebate), accepted (`acceptSign`).
   */
  wrongSignRows: string[]
  /** 2. Payments that block the statement (not fully assigned, no deposit). */
  blockingPayments: string[]
  /** 3. Hand-recorded payments not found on a statement, on statements due on/after the payment date (and Unbilled). */
  missingPayments: string[]
  /** 3b. Same scope: hand-recorded payments that may duplicate an already-assigned bank line. */
  possibleDuplicatePayments: string[]
  /** 4. Latest statement only: Unbilled rows dated before it that it did not contain. */
  notOnStatementRows: string[]
  notOnStatementPayments: string[]
  count: number
  final: boolean
}

/** The row is a rebate whose sign the user accepted. */
export function signIsAccepted(t: Transaction): boolean {
  return t.signAccepted === true && canAcceptSign(t.kind, t.amount)
}

/** "Accept as a rebate": a negative fee or interest row stays as it is and no longer keeps its statement Draft. */
export function acceptSign(t: Transaction): Transaction {
  if (!canAcceptSign(t.kind, t.amount)) throw new MoneyError(`transaction ${t.id} is not a negative fee or interest row`)
  return { ...t, signAccepted: true }
}

/** Draft vs Final for a statement (or the Unbilled bucket). Final when there is nothing to resolve. */
export function draftIssues(ledger: Ledger, statementId: string): DraftIssues {
  const s = statementById(ledger, statementId)
  if (!s) throw new MoneyError(`unknown statement ${statementId}`)
  const payments = countedPayments(ledger.payments).filter((p) => p.cardId === s.cardId)

  const rows = ledger.transactions.filter((t) => t.statementId === s.id)
  const checkRows = rows.filter((t) => t.check).map((t) => t.id)
  const wrongSignRows = rows.filter((t) => signContradicts(t.kind, t.amount) && !signIsAccepted(t)).map((t) => t.id)
  // A missing payment matters to bills due on or after it, not to older (e.g. back-filled) statements.
  const inScope = payments.filter((p) => s.kind === 'unbilled' || s.dueDate >= p.date)
  const withStatus = (kind: string) => inScope.filter((p) => bankStatus(ledger, p).kind === kind).map((p) => p.id)
  const missingPayments = withStatus('missing')
  const possibleDuplicatePayments = withStatus('possibleDuplicate')
  const listed = [...missingPayments, ...possibleDuplicatePayments]
  const blockingPayments = payments.filter((p) => !listed.includes(p.id) && blocks(ledger, p, s)).map((p) => p.id)

  const latest = latestBilled(ledger, s.cardId)
  let notOnStatementRows: string[] = []
  let notOnStatementPayments: string[] = []
  if (latest && latest.id === s.id) {
    const unbilled = new Set(ledger.statements.filter((x) => x.cardId === s.cardId && x.kind === 'unbilled').map((x) => x.id))
    notOnStatementRows = ledger.transactions
      .filter((t) => unbilled.has(t.statementId) && t.date < latest.statementDate && !t.keepWaiting)
      .map((t) => t.id)
    notOnStatementPayments = payments
      .filter((p) => p.source === 'unbilled' && p.date < latest.statementDate && !p.waiting)
      .map((p) => p.id)
  }

  const count =
    checkRows.length +
    wrongSignRows.length +
    blockingPayments.length +
    missingPayments.length +
    possibleDuplicatePayments.length +
    notOnStatementRows.length +
    notOnStatementPayments.length
  return {
    checkRows,
    wrongSignRows,
    blockingPayments,
    missingPayments,
    possibleDuplicatePayments,
    notOnStatementRows,
    notOnStatementPayments,
    count,
    final: count === 0,
  }
}
