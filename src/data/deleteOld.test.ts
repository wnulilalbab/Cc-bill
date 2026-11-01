import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { dumpIdb, fixture, freshNewDb, seedOldDb, uniqueName } from '../../test/data/oldDb'
import { deleteOldData, migrate, planMigration, type OldBackup } from './migration'
import { parseOldBackup, readOldData } from './old'

const NOW = '2026-11-01T08:00:00.000Z'
const saved = () => {}

async function migrated() {
  const oldName = await seedOldDb(fixture())
  const db = freshNewDb()
  const old = (await readOldData(oldName))!
  const v = await migrate(db, old, planMigration(old), NOW)
  return { oldName, db, v }
}

describe('Delete old data', () => {
  it('G-04 produces the JSON backup first, then deletes the old database', async () => {
    const { oldName, db, v } = await migrated()
    expect(v.ok).toBe(true)
    const seen: { backup: OldBackup; oldStillThere: boolean }[] = []
    const backup = await deleteOldData(db, {
      oldName,
      now: NOW,
      beforeDelete: async (b) => void seen.push({ backup: b, oldStillThere: await Dexie.exists(oldName) }),
    })
    expect(seen).toEqual([{ backup, oldStillThere: true }])
    expect(backup.fileName).toBe('ccbill-old-backup-2026-11-01.json')
    expect(parseOldBackup(backup.json)).toEqual(parseOldBackup(fixture()))
    expect(JSON.parse(backup.json).exportedAt).toBe(NOW)
    expect(await Dexie.exists(oldName)).toBe(false)
    // The new data is untouched.
    expect(await db.transactions.count()).toBe(292)
  })

  it('G-04 refuses without a passing verification', async () => {
    const oldName = await seedOldDb(fixture())
    const before = await dumpIdb(oldName)
    const db = freshNewDb()
    await expect(deleteOldData(db, { oldName, beforeDelete: saved })).rejects.toThrow('Old data can only be deleted after a migration has passed verification.')

    // A failed verification is refused too.
    const old = (await readOldData(oldName))!
    const plan = planMigration(old)
    plan.data.transactions.pop()
    expect((await migrate(db, old, plan, NOW)).ok).toBe(false)
    await expect(deleteOldData(db, { oldName, beforeDelete: saved })).rejects.toThrow('after a migration has passed verification')
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-04 refuses when the old data changed after verification, or is not there', async () => {
    const { oldName, db } = await migrated()
    const other = await seedOldDb({ ...fixture(), owners: fixture().owners.slice(1) })
    await expect(deleteOldData(db, { oldName: other, beforeDelete: saved })).rejects.toThrow('The old data changed after it was verified. Run the migration again before deleting it.')
    expect(await Dexie.exists(other)).toBe(true)
    await expect(deleteOldData(db, { oldName: uniqueName('none'), beforeDelete: saved })).rejects.toThrow('There is no old data to delete.')
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  it('G-04 deletes nothing when saving the backup fails', async () => {
    const { oldName, db } = await migrated()
    await expect(deleteOldData(db, { oldName, beforeDelete: () => { throw new Error('download failed') } })).rejects.toThrow('download failed')
    await expect(deleteOldData(db, { oldName, beforeDelete: () => Promise.reject(new Error('cancelled')) })).rejects.toThrow('cancelled')
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  it('G-04 requires the backup step: without beforeDelete nothing is deleted', async () => {
    const { oldName, db } = await migrated()
    const message = 'The backup must be saved before the old data is deleted (beforeDelete is required).'
    await expect(deleteOldData(db, { oldName } as never)).rejects.toThrow(message)
    await expect(deleteOldData(db, { oldName, beforeDelete: 'yes' } as never)).rejects.toThrow(message)
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  it('G-04 waits for the backup step to resolve before deleting', async () => {
    const { oldName, db } = await migrated()
    let release!: () => void
    const beforeDelete = vi.fn(() => new Promise<void>((r) => (release = r)))
    const pending = deleteOldData(db, { oldName, beforeDelete })
    await vi.waitFor(() => expect(beforeDelete).toHaveBeenCalled())
    expect(await Dexie.exists(oldName)).toBe(true)
    release()
    expect((await pending).json.length).toBeGreaterThan(1000)
    expect(await Dexie.exists(oldName)).toBe(false)
  })

  it('G-04 refuses when migrated records were removed from the new database after verification', async () => {
    const { oldName, db } = await migrated()
    await db.transactions.bulkDelete(['tx-0001', 'tx-0002'])
    await expect(deleteOldData(db, { oldName, beforeDelete: saved })).rejects.toThrow(
      'The migrated data is no longer complete in the new app (2 records missing). Run the migration again before deleting the old data.',
    )
    await db.transactions.clear()
    await db.meta.delete('migration')
    await expect(deleteOldData(db, { oldName, beforeDelete: saved })).rejects.toThrow('There is no record of a migration in the new app. Run the migration first.')
    expect(await Dexie.exists(oldName)).toBe(true)
  })
})
