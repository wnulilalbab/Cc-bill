// Step 2 of an import: write the reviewed draft through src/data in one database transaction (all or nothing),
// plus the "Not on <month> statement" answers for Unbilled rows (I-10).
import type { NewDb } from '../data/db'
import { loadLedger } from '../data/repo'
import { checkRecord } from '../data/validate'
import { deleteTransaction, keepWaitingRow } from '../domain/payments'
import { ImportError, type ImportDraft } from './draft'
import { planImport, type ImportReport } from './plan'
import { IMPORT_META_PREFIX } from './read'

let seq = 0
export const newImportId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** What saving would do, without saving (for the review screen). */
export async function previewImport(db: NewDb, draft: ImportDraft): Promise<ImportReport> {
  const card = await db.cards.get(draft.cardId)
  if (!card) throw new ImportError('This card no longer exists.')
  const [ledger, owners, rules] = await Promise.all([loadLedger(db, card.id), db.owners.where('cardId').equals(card.id).toArray(), db.rules.where('cardId').equals(card.id).toArray()])
  return planImport({ ledger, card, owners, rules, draft, newId: newImportId, acceptDifference: true }).report
}

export interface CommitOptions {
  /** The user confirmed saving although the totals differ. */
  acceptDifference?: boolean
  newId?: (prefix: string) => string
}

/** Saves the import. Every record is checked before writing; any failure leaves the database unchanged. */
export async function commitImport(db: NewDb, draft: ImportDraft, { acceptDifference, newId = newImportId }: CommitOptions = {}): Promise<ImportReport> {
  return db.transaction('rw', [db.cards, db.owners, db.rules, db.statements, db.transactions, db.payments, db.plans, db.meta], async () => {
    const card = await db.cards.get(draft.cardId)
    if (!card) throw new ImportError('This card no longer exists.')
    const [ledger, owners, rules] = await Promise.all([loadLedger(db, card.id), db.owners.where('cardId').equals(card.id).toArray(), db.rules.where('cardId').equals(card.id).toArray()])
    const plan = planImport({ ledger, card, owners, rules, draft, newId, acceptDifference })
    plan.statements.forEach((r) => checkRecord('statements', r))
    plan.transactions.forEach((r) => checkRecord('transactions', r))
    plan.payments.forEach((r) => checkRecord('payments', r))
    plan.plans.forEach((r) => checkRecord('plans', r))
    await db.statements.bulkPut(plan.statements)
    await db.transactions.bulkDelete(plan.deleteTransactions)
    await db.payments.bulkDelete(plan.deletePayments)
    await db.transactions.bulkPut(plan.transactions)
    await db.payments.bulkPut(plan.payments)
    await db.plans.bulkPut(plan.plans)
    await db.meta.put({ key: `${IMPORT_META_PREFIX}${draft.fileHash}`, value: { at: new Date().toISOString(), statementId: plan.report.statementId } })
    return plan.report
  })
}

/** "Not on <month> statement" → Delete (payments on it go back to To assign) or Keep waiting. */
export async function resolveNotOnStatement(db: NewDb, txId: string, choice: 'delete' | 'keepWaiting'): Promise<void> {
  await db.transaction('rw', [db.transactions, db.payments], async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) throw new ImportError('This row no longer exists.')
    if (choice === 'keepWaiting') {
      await db.transactions.put(keepWaitingRow(tx))
      return
    }
    const payments = await db.payments.where('cardId').equals(tx.cardId).toArray()
    const after = deleteTransaction({ transactions: [tx], payments }, txId)
    await db.transactions.delete(txId)
    await db.payments.bulkPut(after.payments.filter((p, i) => p !== payments[i]))
  })
}
