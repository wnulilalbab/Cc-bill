// Testing-mode tools (data layer). The screens that call them come in later slices.
import { deleteTransaction } from '../domain/payments'
import { DATA_TABLES, type DataRecords, type DataTable, type NewDb } from './db'
import { oldDbName } from './env'
import { migrate, planMigration, type MigrationOptions, type Verification } from './migration'
import { MigrationError, parseOldBackup, readOldData } from './old'

/** Empties the new database (data and migration records). The old database is not touched. */
export async function resetNewData(db: NewDb): Promise<void> {
  await db.transaction('rw', [...db.dataTables(), db.meta], async () => {
    for (const t of [...DATA_TABLES, 'meta']) await db.table(t).clear()
  })
}

/** Reads the old database again and migrates it, replacing the earlier migrated records. */
export async function rerunMigration(db: NewDb, options: MigrationOptions = {}, oldName: string = oldDbName()): Promise<Verification> {
  const old = await readOldData(oldName)
  if (!old) throw new MigrationError('There is no old data to migrate.')
  return migrate(db, old, planMigration(old, options))
}

/** Replaces the new data with the synthetic demo household (the old-format fixture, migrated). */
export async function loadDemoData(db: NewDb): Promise<Verification> {
  const [{ default: backup }, { default: household }] = await Promise.all([
    import('../../test/fixtures/backup/old-backup.json'),
    import('../../test/fixtures/household.json'),
  ])
  const old = parseOldBackup(backup)
  const defaultOwnerId = old.owners.find((o) => o.name === household.cards.bca.defaultOwner)?.id ?? null
  await resetNewData(db)
  return migrate(db, old, planMigration(old, { defaultOwnerId }))
}

function assertTable(table: string): asserts table is DataTable {
  if (!(DATA_TABLES as readonly string[]).includes(table)) throw new MigrationError(`Unknown table "${table}".`)
}

export async function inspectRecord<K extends DataTable>(db: NewDb, table: K, id: string): Promise<DataRecords[K] | undefined> {
  assertTable(table)
  return db.table<DataRecords[K], string>(table).get(id)
}

/**
 * Deletes one record. Deleting a transaction also removes the assignments that paid it, so those payments get
 * that money back to assign. Returns false when there was no such record.
 */
export async function deleteRow(db: NewDb, table: DataTable, id: string): Promise<boolean> {
  assertTable(table)
  return db.transaction('rw', [db.table(table), db.payments], async () => {
    if (!(await db.table(table).get(id))) return false
    await db.table(table).delete(id)
    if (table === 'transactions') {
      const covering = await db.payments.filter((p) => p.allocations.some((a) => a.txId === id)).toArray()
      const { payments } = deleteTransaction({ transactions: [], payments: covering }, id)
      await db.payments.bulkPut(payments)
    }
    return true
  })
}
