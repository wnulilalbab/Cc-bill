// Shape and money checks for records of the new database. Used by every repository write and by backup import,
// so nothing reaches the database that the money core would reject.
import { allocatedOf } from '../domain/amounts'
import { assertRupiah } from '../domain/money'
import type { InstallmentPlan, Payment, Statement, Transaction } from '../domain/types'
import type { DataRecords, DataTable } from './db'

export class RecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordError'
  }
}

const TX_KINDS = new Set(['purchase', 'installment', 'fee', 'interest', 'refund', 'reversal'])
const SOURCES = new Set(['statement', 'unbilled', 'manual'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const need = (ok: boolean, message: string) => {
  if (!ok) throw new RecordError(message)
}
const ownerOk = (v: unknown) => v === null || isText(v)

function checkStatement(s: Statement, what: string): void {
  need(s.kind === 'billed' || s.kind === 'unbilled', `${what} kind must be "billed" or "unbilled"`)
  if (s.kind !== 'billed') return
  need(typeof s.statementDate === 'string' && ISO_DATE.test(s.statementDate), `${what} statementDate must be a date (YYYY-MM-DD)`)
  need(typeof s.dueDate === 'string' && ISO_DATE.test(s.dueDate), `${what} dueDate must be a date (YYYY-MM-DD)`)
  need(typeof s.printed === 'object' && s.printed !== null, `${what} printed totals are missing`)
  for (const k of ['prevBalance', 'credits', 'purchases', 'feesInterest', 'newBalance'] as const) assertRupiah(s.printed[k], `${what} printed ${k}`)
}

function checkTransaction(t: Transaction, what: string): void {
  need(isText(t.statementId), `${what} statementId must be a non-empty text`)
  need(TX_KINDS.has(t.kind), `${what} kind must be one of ${[...TX_KINDS].join(', ')}`)
  need(typeof t.date === 'string' && ISO_DATE.test(t.date), `${what} date must be a date (YYYY-MM-DD)`)
  need(ownerOk(t.ownerId), `${what} ownerId must be a text or null`)
  assertRupiah(t.amount, `${what} amount`)
}

function checkPayment(p: Payment, what: string): void {
  need(SOURCES.has(p.source), `${what} source must be one of ${[...SOURCES].join(', ')}`)
  need(typeof p.date === 'string' && ISO_DATE.test(p.date), `${what} date must be a date (YYYY-MM-DD)`)
  need(Array.isArray(p.allocations), `${what} allocations must be a list`)
  for (const a of p.allocations) need(typeof a === 'object' && a !== null && isText(a.txId), `${what} has an allocation without a txId`)
  allocatedOf(p) // integer, positive amount; integer, non-negative allocations
}

function checkPlan(p: InstallmentPlan, what: string): void {
  need(ownerOk(p.ownerId), `${what} ownerId must be a text or null`)
  need(Number.isSafeInteger(p.total) && p.total >= 1, `${what} total must be a whole number of months`)
  assertRupiah(p.monthly, `${what} monthly amount`)
}

/** Throws (RecordError, or the domain's MoneyError) when `record` cannot be stored in `table`. */
export function checkRecord<K extends DataTable>(table: K, record: DataRecords[K]): void {
  const r = record as unknown as Record<string, unknown> | null
  need(typeof r === 'object' && r !== null && !Array.isArray(r), `${table} record must be an object`)
  need(isText(r!.id), `${table} record has no id`)
  const what = `${table.slice(0, -1)} ${r!.id as string}`
  if (table === 'cards') {
    need(isText(r!.name), `${what} name must be a non-empty text`)
    need(ownerOk(r!.defaultOwnerId), `${what} defaultOwnerId must be a text or null`)
    return
  }
  need(isText(r!.cardId), `${what} cardId must be a non-empty text`)
  if (table === 'owners') need(isText(r!.name), `${what} name must be a non-empty text`)
  else if (table === 'statements') checkStatement(record as Statement, what)
  else if (table === 'transactions') checkTransaction(record as Transaction, what)
  else if (table === 'payments') checkPayment(record as Payment, what)
  else checkPlan(record as InstallmentPlan, what)
}
