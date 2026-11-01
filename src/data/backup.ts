// JSON backup of the Phase-1 database (export, and import that replaces everything).
import { DATA_TABLES, type NewData, type NewDb } from './db'
import { MigrationError } from './old'

export const BACKUP_FORMAT = 'ccbill-v2-backup'
export const BACKUP_VERSION = 1

export async function exportNewBackup(db: NewDb, exportedAt: string = new Date().toISOString()): Promise<string> {
  const data = {} as Record<string, unknown[]>
  await db.transaction('r', db.dataTables(), async () => {
    for (const t of DATA_TABLES) data[t] = await db.table(t).toArray()
  })
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data }, null, 2)
}

export function parseNewBackup(json: string): NewData {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new MigrationError('The backup is not valid JSON.')
  }
  const obj = raw as { format?: unknown; version?: unknown; data?: Record<string, unknown> } | null
  if (obj?.format !== BACKUP_FORMAT) throw new MigrationError('This file is not a CC Bill backup of the new app.')
  if (obj.version !== BACKUP_VERSION) throw new MigrationError(`Unsupported backup version ${JSON.stringify(obj.version)}.`)
  for (const t of DATA_TABLES) {
    const rows = obj.data?.[t]
    if (!Array.isArray(rows)) throw new MigrationError(`The backup is missing the "${t}" list.`)
    rows.forEach((r: { id?: unknown } | null, i) => {
      if (typeof r?.id !== 'string') throw new MigrationError(`${t}[${i}] has no id.`)
    })
  }
  return obj.data as unknown as NewData
}

/** Replaces every record of the new database with the backup's, in one transaction. */
export async function importNewBackup(db: NewDb, json: string): Promise<void> {
  const data = parseNewBackup(json)
  await db.transaction('rw', [...db.dataTables(), db.meta], async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkPut(data[t])
    }
    await db.meta.clear() // a migration record would point at ids that may no longer be there
  })
}
