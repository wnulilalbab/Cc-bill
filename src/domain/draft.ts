import { countedPayments } from './amounts'
import { MoneyError } from './money'
import { bankStatus, blocks } from './payments'
import { latestBilled, statementById } from './statements'
import type { Ledger } from './types'

export interface DraftIssues {
  /** 1. Rows on the statement with Check. */
  checkRows: string[]
  /** 2. Payments that block the statement (not fully assigned, no deposit). */
  blockingPayments: string[]
  /** 3. Hand-recorded payments not found on a statement (card-wide). */
  missingPayments: string[]
  /** 4. Latest statement only: Unbilled rows dated before it that it did not contain. */
  notOnStatementRows: string[]
  notOnStatementPayments: string[]
  count: number
  final: boolean
}

/** Draft vs Final for a statement (or the Unbilled bucket). Final when there is nothing to resolve. */
export function draftIssues(ledger: Ledger, statementId: string): DraftIssues {
  const s = statementById(ledger, statementId)
  if (!s) throw new MoneyError(`unknown statement ${statementId}`)
  const payments = countedPayments(ledger.payments).filter((p) => p.cardId === s.cardId)

  const checkRows = ledger.transactions.filter((t) => t.statementId === s.id && t.check).map((t) => t.id)
  const missingPayments = payments.filter((p) => bankStatus(ledger, p).kind === 'missing').map((p) => p.id)
  const blockingPayments = payments.filter((p) => !missingPayments.includes(p.id) && blocks(ledger, p, s)).map((p) => p.id)

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

  const count = checkRows.length + blockingPayments.length + missingPayments.length + notOnStatementRows.length + notOnStatementPayments.length
  return { checkRows, blockingPayments, missingPayments, notOnStatementRows, notOnStatementPayments, count, final: count === 0 }
}
