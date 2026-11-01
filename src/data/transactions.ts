// Row edits on the Transactions screen (docs/intent/phase-1.md §6): review, bulk owner, fix, add, delete, convert.
// Money rules live in src/domain; each function here reads and writes in one transaction, every write checked.
import { convertToInstallment, type ConversionError, type ConversionResult } from '../domain/installments'
import { sum } from '../domain/money'
import { deleteTransaction, keepWaitingRow } from '../domain/payments'
import { withManualOwner } from '../domain/tagging/apply'
import type { Transaction, TxKind } from '../domain/types'
import { paidRowIds } from './coverage'
import type { NewDb } from './db'
import { loadLedger } from './repo'
import { checkRecord } from './validate'

export class RowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RowError'
  }
}

let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

async function rowOrThrow(db: NewDb, txId: string): Promise<Transaction> {
  const t = await db.transactions.get(txId)
  if (!t) throw new RowError('This transaction no longer exists.')
  return t
}

async function checkOwner(db: NewDb, cardId: string, ownerId: string | null): Promise<void> {
  if (ownerId === null) return
  const o = await db.owners.get(ownerId)
  if (!o || o.cardId !== cardId) throw new RowError('Pick an owner of this card.')
  if (o.archived) throw new RowError(`${o.name} is archived. Pick another owner.`)
}

/** Ids of the card's rows that something pays (an assignment or a deposit). */
async function paidIds(db: NewDb, cardId: string): Promise<Set<string>> {
  const [transactions, payments] = await Promise.all([db.transactions.where('cardId').equals(cardId).toArray(), db.payments.where('cardId').equals(cardId).toArray()])
  return paidRowIds({ transactions, payments })
}

/** Installment rows keep their source Plan: the plan decides their owner. */
const keepsSource = (t: Transaction) => t.tagSource === 'plan'
export const isReviewed = (t: Transaction) => !t.check && (t.tagSource === 'manual' || keepsSource(t))

/** The row confirmed as it is: Check cleared; source You (Plan rows stay Plan). */
function reviewed(t: Transaction): Transaction {
  if (!keepsSource(t)) return withManualOwner(t, t.ownerId)
  const { check: _check, ...rest } = t
  return rest
}

/**
 * "Mark reviewed": the user confirms the owner the rows have. Check cleared and source You, so tagging history
 * (which learns only from rows the user confirmed) can learn from them; rows from an installment plan stay Plan.
 * Owners and payments do not change. Returns the number of rows changed.
 */
export async function markReviewed(db: NewDb, txIds: readonly string[]): Promise<number> {
  return db.transaction('rw', db.transactions, async () => {
    const rows = (await db.transactions.bulkGet([...txIds])).filter((t): t is Transaction => !!t && !isReviewed(t))
    const next = rows.map(reviewed)
    next.forEach((t) => checkRecord('transactions', t))
    await db.transactions.bulkPut(next)
    return next.length
  })
}

export interface BulkOwnerPreview {
  /** Rows that will change (owner set, Check cleared, source You). */
  change: Transaction[]
  /** Rows the user tagged by hand with another owner: changed only when the user opts in. */
  manual: Transaction[]
  /** Rows with another owner that a payment covers: never changed in bulk (one by one, with Keep / Unassign). */
  paid: number
  /** Selected rows already reviewed with this owner. */
  unchanged: number
}

/** What "Set owner" on the selected rows would do. */
export async function previewBulkOwner(db: NewDb, txIds: readonly string[], ownerId: string | null): Promise<BulkOwnerPreview> {
  const rows = (await db.transactions.bulkGet([...txIds])).filter((t): t is Transaction => !!t)
  const paid = new Set<string>()
  for (const cardId of new Set(rows.map((t) => t.cardId))) (await paidIds(db, cardId)).forEach((id) => paid.add(id))
  const out: BulkOwnerPreview = { change: [], manual: [], paid: 0, unchanged: 0 }
  for (const t of rows) {
    const moves = t.ownerId !== ownerId
    if (!moves && isReviewed(t)) out.unchanged++
    else if (moves && paid.has(t.id)) out.paid++
    else if (moves && t.tagSource === 'manual') out.manual.push(t)
    else out.change.push(t)
  }
  return out
}

export interface BulkOwnerResult {
  changed: number
  paidSkipped: number
  manualSkipped: number
}

/**
 * "Set owner" on many rows. Rows a payment covers are skipped (the Keep / Unassign question is asked one row at a
 * time); rows tagged by hand change only with `includeManual`. Re-reads everything in the same transaction.
 */
export async function bulkSetOwner(
  db: NewDb,
  txIds: readonly string[],
  ownerId: string | null,
  { includeManual = false }: { includeManual?: boolean } = {},
): Promise<BulkOwnerResult> {
  return db.transaction('rw', [db.transactions, db.payments, db.owners], async () => {
    const selected = (await db.transactions.bulkGet([...txIds])).filter((t): t is Transaction => !!t)
    for (const cardId of new Set(selected.map((t) => t.cardId))) await checkOwner(db, cardId, ownerId)
    const preview = await previewBulkOwner(db, txIds, ownerId)
    const rows = [...preview.change, ...(includeManual ? preview.manual : [])]
    const next = rows.map((t) => withManualOwner(t, ownerId))
    next.forEach((t) => checkRecord('transactions', t))
    await db.transactions.bulkPut(next)
    return { changed: next.length, paidSkipped: preview.paid, manualSkipped: includeManual ? 0 : preview.manual.length }
  })
}

export interface RowPatch {
  amount?: number
  date?: string
  description?: string
  /** Empty = no label. */
  label?: string
}

export const INSTALLMENT_AMOUNT = 'This is an installment: its amount comes from the plan. Edit the plan instead.'
export const UNDO_CONVERSION = 'Undo the installment conversion first.'

/** A row that is part of an installment conversion (the cancelled original or its linked reversal). */
export const isConverted = (t: Transaction) => !!t.cancelled || (t.kind === 'reversal' && !!t.reverses)

/**
 * "Fix amount, date or description" and the label; only the fields given change. A charge's amount cannot drop
 * below what payments explicitly assign to it (that money would vanish): unassign first. An installment's amount
 * comes from its plan and is not edited here.
 */
export async function updateRow(db: NewDb, txId: string, patch: RowPatch): Promise<Transaction> {
  return db.transaction('rw', [db.transactions, db.payments], async () => {
    const t = await rowOrThrow(db, txId)
    const next: Transaction = { ...t }
    if (patch.amount !== undefined && patch.amount !== t.amount) {
      if (!Number.isSafeInteger(patch.amount) || patch.amount === 0) throw new RowError('Enter the amount in whole rupiah.')
      if (t.kind === 'installment') throw new RowError(INSTALLMENT_AMOUNT)
      const payments = await db.payments.where('cardId').equals(t.cardId).toArray()
      const assigned = sum(payments.flatMap((p) => p.allocations.filter((a) => a.txId === t.id).map((a) => a.amount)))
      if (assigned > 0 && patch.amount < assigned) throw new RowError(`Payments cover Rp ${assigned.toLocaleString('id-ID')} of this row. Unassign them first, or enter at least that.`)
      next.amount = patch.amount
    }
    if (patch.date !== undefined) {
      if (!ISO_DATE.test(patch.date)) throw new RowError('Pick a date.')
      next.date = patch.date
    }
    if (patch.description !== undefined) {
      const d = patch.description.trim().replace(/\s+/g, ' ')
      if (!d) throw new RowError('The description cannot be empty.')
      next.description = d
    }
    if (patch.label !== undefined) {
      const l = patch.label.trim()
      if (l) next.label = l.slice(0, 60)
      else delete next.label
    }
    checkRecord('transactions', next)
    await db.transactions.put(next)
    return next
  })
}

export interface NewRow {
  statementId: string
  date: string
  description: string
  /** Signed rupiah: charges > 0, refunds < 0. */
  amount: number
  kind: TxKind
  ownerId: string | null
  label?: string
}

/** "+ Add a missing transaction" to a statement (or Unbilled): source You. Returns the new row. */
export async function addRow(db: NewDb, row: NewRow): Promise<Transaction> {
  return db.transaction('rw', [db.transactions, db.statements, db.owners], async () => {
    const s = await db.statements.get(row.statementId)
    if (!s) throw new RowError('This statement no longer exists.')
    const description = row.description.trim().replace(/\s+/g, ' ').toUpperCase()
    if (!description) throw new RowError('Add a description.')
    if (!Number.isSafeInteger(row.amount) || row.amount === 0) throw new RowError('Enter the amount in whole rupiah.')
    if (!ISO_DATE.test(row.date)) throw new RowError('Pick a date.')
    await checkOwner(db, s.cardId, row.ownerId)
    const t: Transaction = {
      id: newId('tx'),
      cardId: s.cardId,
      statementId: s.id,
      date: row.date,
      description,
      amount: row.amount,
      kind: row.kind,
      ownerId: row.ownerId,
      tagSource: 'manual',
    }
    const label = row.label?.trim()
    if (label) t.label = label.slice(0, 60)
    checkRecord('transactions', t)
    await db.transactions.put(t)
    return t
  })
}

/** Deletes a row; payments that covered it get that amount back (To assign, or their deposit). Returns how many payments changed. */
export async function deleteRow(db: NewDb, txId: string): Promise<number> {
  return db.transaction('rw', [db.transactions, db.payments], async () => {
    const t = await rowOrThrow(db, txId)
    if (isConverted(t)) throw new RowError(UNDO_CONVERSION)
    const payments = await db.payments.where('cardId').equals(t.cardId).toArray()
    const after = deleteTransaction({ transactions: [t], payments }, t.id)
    const changed = after.payments.filter((p, i) => p !== payments[i])
    changed.forEach((p) => checkRecord('payments', p))
    await db.payments.bulkPut(changed)
    await db.transactions.delete(t.id)
    return changed.length
  })
}

/** "Keep waiting" on an Unbilled row older than the latest statement. */
export async function keepWaitingOn(db: NewDb, txId: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const next = keepWaitingRow(await rowOrThrow(db, txId))
    checkRecord('transactions', next)
    await db.transactions.put(next)
  })
}

export const CONVERSION_ERRORS: Record<ConversionError, string> = {
  notAReversal: 'Only a "REVERSAL CICILAN … *ref" line can be converted.',
  originalNotFound: 'The original purchase (same amount, same *ref) is not on this card yet. Import its statement first.',
  installmentNotFound: 'Installment 1 of this purchase ("CICILAN … KE 01 DARI …") is not on this card yet. Import it first.',
}

/** The conversion a reversal row would make, without saving (for the confirmation). */
export async function previewConversion(db: NewDb, reversalId: string): Promise<ConversionResult | { error: ConversionError }> {
  const t = await rowOrThrow(db, reversalId)
  return convertToInstallment(await loadLedger(db, t.cardId), reversalId, 'preview')
}

/**
 * Installment conversion from a `REVERSAL CICILAN` row (domain convertToInstallment): the original is not counted,
 * its payments move to installment 1/N (excess → the owner's deposit), and the plan is created or linked.
 */
export async function convertRow(db: NewDb, reversalId: string): Promise<ConversionResult> {
  return db.transaction('rw', [db.transactions, db.payments, db.plans, db.statements], async () => {
    const t = await rowOrThrow(db, reversalId)
    const result = convertToInstallment(await loadLedger(db, t.cardId), reversalId, newId('plan'))
    if ('error' in result) throw new RowError(CONVERSION_ERRORS[result.error])
    result.transactions.forEach((x) => checkRecord('transactions', x))
    result.payments.forEach((p) => checkRecord('payments', p))
    checkRecord('plans', result.plan)
    await db.transactions.bulkPut(result.transactions)
    await db.payments.bulkPut(result.payments)
    await db.plans.put(result.plan)
    return result
  })
}
