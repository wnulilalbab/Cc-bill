import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { dumpIdb, fixture, freshNewDb, seedOldDb, uniqueName } from '../../test/data/oldDb'
import { deleteOldData, migrate, planMigration, type OldBackup } from './migration'
import { parseOldBackup, readOldData } from './old'

const NOW = '2026-11-01T08:00:00.000Z'

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
    await expect(deleteOldData(db, { oldName })).rejects.toThrow('Old data can only be deleted after a migration has passed verification.')

    // A failed verification is refused too.
    const old = (await readOldData(oldName))!
    const plan = planMigration(old)
    plan.data.transactions.pop()
    expect((await migrate(db, old, plan, NOW)).ok).toBe(false)
    await expect(deleteOldData(db, { oldName })).rejects.toThrow('after a migration has passed verification')
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-04 refuses when the old data changed after verification, or is not there', async () => {
    const { oldName, db } = await migrated()
    const other = await seedOldDb({ ...fixture(), owners: fixture().owners.slice(1) })
    await expect(deleteOldData(db, { oldName: other })).rejects.toThrow('The old data changed after it was verified. Run the migration again before deleting it.')
    expect(await Dexie.exists(other)).toBe(true)
    await expect(deleteOldData(db, { oldName: uniqueName('none') })).rejects.toThrow('There is no old data to delete.')
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  it('G-04 deletes nothing when saving the backup fails', async () => {
    const { oldName, db } = await migrated()
    await expect(deleteOldData(db, { oldName, beforeDelete: () => { throw new Error('download failed') } })).rejects.toThrow('download failed')
    expect(await Dexie.exists(oldName)).toBe(true)
    // Without a callback it still returns the backup and deletes.
    const b = await deleteOldData(db, { oldName })
    expect(b.json.length).toBeGreaterThan(1000)
    expect(await Dexie.exists(oldName)).toBe(false)
  })
})
