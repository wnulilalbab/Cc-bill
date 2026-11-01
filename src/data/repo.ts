// CRUD on the Phase-1 database. Thin and typed: money rules live in src/domain; every write is checked (validate.ts).
import type { TagRule } from '../domain/tagging/types'
import type { Card, InstallmentPlan, Ledger, Owner, Payment, Statement, Transaction } from '../domain/types'
import { DATA_TABLES, emptyData, type DataRecords, type DataTable, type NewData, type NewDb } from './db'
import { checkRecord } from './validate'

export interface TableRepo<T> {
  get(id: string): Promise<T | undefined>
  list(): Promise<T[]>
  put(record: T): Promise<void>
  remove(id: string): Promise<void>
}

/** Card-scoped tables also list by card. */
export interface CardScopedRepo<T> extends TableRepo<T> {
  byCard(cardId: string): Promise<T[]>
}

function tableRepo<K extends DataTable>(db: NewDb, name: K): TableRepo<DataRecords[K]> {
  const table = () => db.table<DataRecords[K], string>(name)
  return {
    get: (id) => table().get(id),
    list: () => table().toArray(),
    put: async (record) => {
      checkRecord(name, record)
      await table().put(record)
    },
    remove: (id) => table().delete(id),
  }
}

function cardScoped<K extends Exclude<DataTable, 'cards'>>(db: NewDb, name: K): CardScopedRepo<DataRecords[K]> {
  return { ...tableRepo(db, name), byCard: (cardId) => db.table<DataRecords[K], string>(name).where('cardId').equals(cardId).toArray() }
}

export interface Repos {
  cards: TableRepo<Card>
  owners: CardScopedRepo<Owner>
  statements: CardScopedRepo<Statement>
  transactions: CardScopedRepo<Transaction> & { byStatement(statementId: string): Promise<Transaction[]> }
  payments: CardScopedRepo<Payment>
  plans: CardScopedRepo<InstallmentPlan>
  rules: CardScopedRepo<TagRule>
}

export function repos(db: NewDb): Repos {
  return {
    cards: tableRepo(db, 'cards'),
    owners: cardScoped(db, 'owners'),
    statements: cardScoped(db, 'statements'),
    transactions: { ...cardScoped(db, 'transactions'), byStatement: (id) => db.transactions.where('statementId').equals(id).toArray() },
    payments: cardScoped(db, 'payments'),
    plans: cardScoped(db, 'plans'),
    rules: cardScoped(db, 'rules'),
  }
}

/** Everything the money functions need for one card. */
export async function loadLedger(db: NewDb, cardId: string): Promise<Ledger> {
  const r = repos(db)
  const [statements, transactions, payments, plans] = await Promise.all([
    r.statements.byCard(cardId),
    r.transactions.byCard(cardId),
    r.payments.byCard(cardId),
    r.plans.byCard(cardId),
  ])
  return { statements, transactions, payments, plans }
}

/** Every domain record, in primary-key order (so two reads of the same data compare equal). */
export async function readAll(db: NewDb): Promise<NewData> {
  const out = emptyData()
  await db.transaction('r', db.dataTables(), async () => {
    for (const t of DATA_TABLES) {
      ;(out[t] as unknown[]) = await db.table(t).toArray()
    }
  })
  return out
}
