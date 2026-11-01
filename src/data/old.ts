// The pre-Phase-1 data: its format, reading it (read-only), validating a backup and producing the JSON backup.
import Dexie from 'dexie'
import type {
  BillPeriod as OldPeriod,
  Expense as OldExpense,
  InstallmentPlan as OldPlan,
  Owner as OldOwner,
  Payment as OldPayment,
  PaymentAllocation as OldAllocation,
  Transaction as OldTransaction,
} from '../types'
import { oldDbName } from './env'

export type { OldAllocation, OldExpense, OldOwner, OldPayment, OldPeriod, OldPlan, OldTransaction }

/** The old database, in the shape of the old app's JSON backup (the old app's Settings → Export; synthetic sample in test/fixtures/backup/old-backup.json). */
export interface OldData {
  owners: OldOwner[]
  periods: OldPeriod[]
  transactions: OldTransaction[]
  expenses: OldExpense[]
  installmentPlans: OldPlan[]
  payments: OldPayment[]
  paymentAllocations: OldAllocation[]
}

export const OLD_TABLES = ['owners', 'periods', 'transactions', 'expenses', 'installmentPlans', 'payments', 'paymentAllocations'] as const satisfies readonly (keyof OldData)[]

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

const OLD_TYPES = new Set(['purchase', 'installment', 'payment', 'refund', 'reversal', 'fee', 'interest'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

type Field = 'string' | 'text' | 'date' | 'month' | 'rupiah' | 'count' | 'months' | 'type' | 'boolean'
type Shape = Record<string, `${Field}` | `${Field}?`>

const SHAPES: Record<keyof OldData, Shape> = {
  owners: { id: 'string', name: 'string' },
  periods: { id: 'string', month: 'count', year: 'count', dueDate: 'date?' },
  transactions: { id: 'string', periodId: 'string', date: 'date', description: 'text', amount: 'rupiah', type: 'type', hidden: 'boolean?' },
  expenses: { id: 'string', transactionId: 'string', ownerId: 'string', installmentPlanId: 'string?' },
  installmentPlans: { id: 'string', name: 'string', totalMonths: 'months', monthlyAmount: 'rupiah', startPeriod: 'month', ownerId: 'string' },
  payments: { id: 'string', periodId: 'string', date: 'date', amount: 'rupiah', note: 'text?' },
  paymentAllocations: { id: 'string', paymentId: 'string', expenseId: 'string', amount: 'rupiah' },
}

function fieldOk(kind: Field, v: unknown): boolean {
  switch (kind) {
    case 'string': return typeof v === 'string' && v.length > 0
    case 'text': return typeof v === 'string'
    case 'date': return typeof v === 'string' && ISO_DATE.test(v)
    case 'month': return typeof v === 'string' && ISO_MONTH.test(v)
    case 'rupiah': return Number.isSafeInteger(v)
    case 'count': return Number.isSafeInteger(v) && (v as number) >= 0
    case 'months': return Number.isSafeInteger(v) && (v as number) >= 1
    case 'type': return typeof v === 'string' && OLD_TYPES.has(v)
    case 'boolean': return typeof v === 'boolean'
  }
}

const EXPECTED: Record<Field, string> = {
  string: 'a non-empty text',
  text: 'a text',
  date: 'a date (YYYY-MM-DD)',
  month: 'a month (YYYY-MM)',
  rupiah: 'an integer number of rupiah',
  count: 'a whole number',
  months: 'a whole number of months (1 or more)',
  type: `one of ${[...OLD_TYPES].join(', ')}`,
  boolean: 'true or false',
}

/** `typeof` plus a short preview. Never serialises the value: a deeply nested one would overflow the stack. */
export function describeValue(v: unknown): string {
  if (Array.isArray(v)) return `a list of ${v.length}`
  if (v === null) return 'null'
  if (typeof v === 'object') return 'an object'
  const text = typeof v === 'string' ? `"${v}"` : String(v)
  return `${typeof v} ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`
}

/**
 * Checks that `input` (parsed JSON or a JSON string) is an old-format backup. Throws a MigrationError that names
 * the first problem (list, row and field) so the user can tell a wrong file from a damaged one.
 */
export function parseOldBackup(input: unknown): OldData {
  try {
    return parseOrThrow(input)
  } catch (e) {
    if (e instanceof MigrationError) throw e
    throw new MigrationError(`The backup could not be read (${(e as Error).name}: it may be damaged or far too deeply nested).`)
  }
}

function parseOrThrow(input: unknown): OldData {
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      throw new MigrationError('The backup is not valid JSON.')
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MigrationError('The backup is not a CC Bill backup (expected a JSON object).')
  const obj = raw as Record<string, unknown>
  const out = {} as Record<keyof OldData, unknown[]>
  for (const table of OLD_TABLES) {
    const rows = obj[table]
    if (!Array.isArray(rows)) throw new MigrationError(`The backup is missing the "${table}" list.`)
    const seen = new Set<string>()
    rows.forEach((row: unknown, i) => {
      const where = `${table}[${i}]`
      if (typeof row !== 'object' || row === null) throw new MigrationError(`${where} is not a record.`)
      const r = row as Record<string, unknown>
      for (const [key, spec] of Object.entries(SHAPES[table])) {
        const optional = spec.endsWith('?')
        const kind = spec.replace('?', '') as Field
        if (optional && r[key] === undefined) continue
        if (!fieldOk(kind, r[key])) throw new MigrationError(`${where}.${key} must be ${EXPECTED[kind]}, got ${describeValue(r[key])}.`)
      }
      if (seen.has(r.id as string)) throw new MigrationError(`${table} has the id "${r.id}" twice.`)
      seen.add(r.id as string)
    })
    out[table] = rows
  }
  const periods = new Set((out.periods as OldPeriod[]).map((p) => p.id))
  for (const t of out.transactions as OldTransaction[]) {
    if (!periods.has(t.periodId)) throw new MigrationError(`Transaction ${t.id} points to a statement (${t.periodId}) that is not in the backup.`)
    if (t.type === 'payment' && t.amount >= 0) throw new MigrationError(`Transaction ${t.id} is a payment but its amount is not negative (${t.amount}).`)
  }
  for (const p of out.payments as OldPayment[]) {
    if (p.amount <= 0) throw new MigrationError(`Payment ${p.id} must have a positive amount, got ${p.amount}.`)
  }
  for (const a of out.paymentAllocations as OldAllocation[]) {
    if (a.amount < 0) throw new MigrationError(`Assignment ${a.id} has a negative amount (${a.amount}).`)
  }
  JSON.stringify(out) // the plan fingerprints and backs up this data: anything that cannot be serialised fails here
  return out as unknown as OldData
}

/** Opens the old database without upgrading or creating it. `null` when it does not exist. */
async function openOld(name: string): Promise<Dexie | null> {
  if (!(await Dexie.exists(name))) return null
  const db = new Dexie(name) // no version(): dynamic mode, never changes the schema
  await db.open()
  return db
}

/** Reads and validates the whole old database. Read-only. `null` when there is no old database. */
export async function readOldData(name: string = oldDbName()): Promise<OldData | null> {
  const db = await openOld(name)
  if (!db) return null
  try {
    const out = {} as Record<keyof OldData, unknown[]>
    for (const t of OLD_TABLES) out[t] = db.tables.some((x) => x.name === t) ? await db.table(t).toArray() : []
    return parseOldBackup(out)
  } finally {
    db.close()
  }
}

/** The old app's backup file content: same shape and formatting as its own "Export Data (JSON backup)". */
export function oldBackupJson(data: OldData, exportedAt: string): string {
  return JSON.stringify({ ...pickOld(data), exportedAt }, null, 2)
}

function pickOld(data: OldData): OldData {
  return Object.fromEntries(OLD_TABLES.map((t) => [t, data[t]])) as unknown as OldData
}

/** FNV-1a over the canonical JSON: detects any change to the old data between verification and deletion. */
export function fingerprint(data: OldData): string {
  const text = JSON.stringify(pickOld(data))
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${text.length}:${h.toString(16).padStart(8, '0')}`
}
