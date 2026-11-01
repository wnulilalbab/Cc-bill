import type { BilledStatement, Ledger, Statement } from './types'

export function statementById(ledger: Pick<Ledger, 'statements'>, id: string): Statement | undefined {
  return ledger.statements.find((s) => s.id === id)
}

/** Billed statements of a card, oldest first. */
export function billedOf(ledger: Pick<Ledger, 'statements'>, cardId: string): BilledStatement[] {
  return ledger.statements
    .filter((s): s is BilledStatement => s.cardId === cardId && s.kind === 'billed')
    .sort((a, b) => a.statementDate.localeCompare(b.statementDate))
}

export function latestBilled(ledger: Pick<Ledger, 'statements'>, cardId: string): BilledStatement | undefined {
  const list = billedOf(ledger, cardId)
  return list[list.length - 1]
}

/** The billed statement just before `s` on the same card (for Unbilled: the latest billed one). */
export function previousBilled(ledger: Pick<Ledger, 'statements'>, s: Statement): BilledStatement | undefined {
  const older = billedOf(ledger, s.cardId).filter((x) => s.kind === 'unbilled' || x.statementDate < s.statementDate)
  return older[older.length - 1]
}

/** Sort key: billed statements by date, the Unbilled bucket after every billed one. */
export function statementSortKey(s: Statement): string {
  return s.kind === 'billed' ? s.statementDate : '9999-12-31'
}
