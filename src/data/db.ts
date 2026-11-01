// The Phase-1 IndexedDB database. Stores the domain model of src/domain/types.ts as is.
import Dexie, { type DexieOptions, type Table } from 'dexie'
import type { Card, InstallmentPlan, Owner, Payment, Statement, Transaction } from '../domain/types'
import { newDbName } from './env'

/** Bookkeeping records (migration run, verification). Never domain data. */
export interface MetaRecord {
  key: string
  value: unknown
}

export const DATA_TABLES = ['cards', 'owners', 'statements', 'transactions', 'payments', 'plans'] as const
export type DataTable = (typeof DATA_TABLES)[number]

export interface DataRecords {
  cards: Card
  owners: Owner
  statements: Statement
  transactions: Transaction
  payments: Payment
  plans: InstallmentPlan
}

/** Every domain record in the database, one array per table. */
export type NewData = { [K in DataTable]: DataRecords[K][] }

export const emptyData = (): NewData => ({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [] })

export class NewDb extends Dexie {
  cards!: Table<Card, string>
  owners!: Table<Owner, string>
  statements!: Table<Statement, string>
  transactions!: Table<Transaction, string>
  payments!: Table<Payment, string>
  plans!: Table<InstallmentPlan, string>
  meta!: Table<MetaRecord, string>

  constructor(name: string = newDbName(), options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      cards: '&id, name',
      owners: '&id, cardId',
      statements: '&id, cardId, kind, statementDate',
      transactions: '&id, cardId, statementId, date, ownerId, planId',
      payments: '&id, cardId, source, statementId, date',
      plans: '&id, cardId',
      meta: '&key',
    })
  }

  dataTables(): Table[] {
    return DATA_TABLES.map((t) => this.table(t))
  }
}

let shared: NewDb | undefined

/** The app's database for the current environment (opened lazily). */
export function getNewDb(): NewDb {
  return (shared ??= new NewDb())
}
