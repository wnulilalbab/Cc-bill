// JSON backup of the Phase-1 database (export, and import that replaces everything).
import { DATA_TABLES, type DataRecords, type NewData, type NewDb } from './db'
import { MigrationError } from './old'
import { checkRecord } from './validate'

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
    // Backups made before tagging rules existed (Slice 7) have no "rules" list: no rules.
    if (t === 'rules' && obj.data && !('rules' in obj.data)) obj.data.rules = []
    const rows = obj.data?.[t]
    if (!Array.isArray(rows)) throw new MigrationError(`The backup is missing the "${t}" list.`)
    const seen = new Set<string>()
    rows.forEach((r: DataRecords[typeof t], i) => {
      try {
        checkRecord(t, r)
      } catch (e) {
        throw new MigrationError(`${t}[${i}] is invalid: ${(e as Error).message}.`)
      }
      if (seen.has(r.id)) throw new MigrationError(`${t} has the id "${r.id}" twice.`)
      seen.add(r.id)
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
