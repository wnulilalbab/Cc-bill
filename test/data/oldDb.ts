// Test helpers for the old (pre-Phase-1) database. Synthetic data only.
import Dexie from 'dexie'
import { NewDb } from '../../src/data/db'
import type { OldData } from '../../src/data/old'
import backup from '../fixtures/backup/old-backup.json'

/** The old app's schema (its Dexie `CCBillDB`, version 2; the old screens were retired in Slice 12). */
export const OLD_SCHEMA = {
  owners: '&id, name',
  periods: '&id, year, month, type',
  transactions: '&id, periodId, type, date, hidden, source',
  expenses: '&id, transactionId, ownerId, status, installmentPlanId',
  installmentPlans: '&id, ownerId, startPeriod',
  payments: '&id, periodId, date',
  paymentAllocations: '&id, paymentId, expenseId',
  settings: '&key',
}

let n = 0
export const uniqueName = (prefix: string) => `${prefix}-${++n}-${Math.random().toString(36).slice(2, 8)}`

export const fixture = (): OldData => structuredClone(backup) as unknown as OldData

/** Creates an old database the way the old app does, filled with `data` plus a synthetic settings row. */
export async function seedOldDb(data: OldData, name = uniqueName('CCBillDB')): Promise<string> {
  const db = new Dexie(name)
  db.version(1).stores({ ...OLD_SCHEMA, periods: '&id, year, month', transactions: '&id, periodId, type, date, hidden' })
  db.version(2).stores(OLD_SCHEMA)
  await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const [table, rows] of Object.entries(data)) if (Array.isArray(rows)) await db.table(table).bulkPut(rows)
    await db.table('settings').put({ key: 'claude_model', value: 'synthetic-model' })
  })
  db.close()
  return name
}

/** Raw IndexedDB dump: version, store names, and every record of every store. */
export async function dumpIdb(name: string): Promise<{ version: number; stores: Record<string, unknown[]> }> {
  const idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const stores: Record<string, unknown[]> = {}
  for (const s of Array.from(idb.objectStoreNames)) {
    stores[s] = await new Promise((resolve, reject) => {
      const req = idb.transaction(s, 'readonly').objectStore(s).getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  const version = idb.version
  idb.close()
  return { version, stores }
}

export const freshNewDb = () => new NewDb(uniqueName('ccbill-v2'))
