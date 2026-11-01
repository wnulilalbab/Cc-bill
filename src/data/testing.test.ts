import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dumpIdb, fixture, freshNewDb, seedOldDb, uniqueName } from '../../test/data/oldDb'
import expected from '../../test/fixtures/backup/old-backup.expected.json'
import { exportNewBackup, importNewBackup } from './backup'
import { MIGRATED_CARD } from './migration'
import { readAll } from './repo'
import { deleteRow, inspectRecord, loadDemoData, rerunMigration, resetNewData } from './testing'

describe('testing-mode tools', () => {
  it('G-05 reset empties the new data, leaves the old DB untouched, and the migration can re-run', async () => {
    const oldName = await seedOldDb(fixture())
    const before = await dumpIdb(oldName)
    const db = freshNewDb()
    expect((await rerunMigration(db, {}, oldName)).ok).toBe(true)
    const first = await readAll(db)

    await resetNewData(db)
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [] })
    expect(await db.meta.count()).toBe(0)
    expect(await dumpIdb(oldName)).toEqual(before)

    expect((await rerunMigration(db, {}, oldName)).ok).toBe(true)
    expect(await readAll(db)).toEqual(first)
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-05 re-run migration fails clearly when there is no old data', async () => {
    await expect(rerunMigration(freshNewDb(), {}, uniqueName('none'))).rejects.toThrow('There is no old data to migrate.')
  })

  it('G-05 load demo data replaces the new data with the synthetic household', async () => {
    const db = freshNewDb()
    await db.cards.put({ id: 'card-x', name: 'X', bank: 'X', defaultOwnerId: null })
    const v = await loadDemoData(db)
    expect(v.ok).toBe(true)
    expect(v.actual.totals.allocated).toBe(expected.totals.allocated)
    const data = await readAll(db)
    expect(data.cards.map((c) => c.id)).toEqual([MIGRATED_CARD.id])
    expect(data.owners.find((o) => o.id === data.cards[0].defaultOwnerId)?.name).toBe('Keluarga')
  })

  it('G-05 inspect a record and delete one row; deleting a row gives its payment the money back', async () => {
    const db = freshNewDb()
    await loadDemoData(db)
    expect(await inspectRecord(db, 'transactions', 'tx-0001')).toMatchObject({ id: 'tx-0001', amount: 21200 })
    expect(await inspectRecord(db, 'owners', 'nope')).toBeUndefined()
    await expect(inspectRecord(db, 'meta' as never, 'migration')).rejects.toThrow('Unknown table "meta".')

    const pay = (await inspectRecord(db, 'payments', 'tx-0046'))!
    expect(pay.allocations.some((a) => a.txId === 'tx-0001')).toBe(true)
    expect(await deleteRow(db, 'transactions', 'tx-0001')).toBe(true)
    expect(await inspectRecord(db, 'transactions', 'tx-0001')).toBeUndefined()
    const after = (await inspectRecord(db, 'payments', 'tx-0046'))!
    expect(after.allocations).toEqual(pay.allocations.filter((a) => a.txId !== 'tx-0001'))
    expect(await inspectRecord(db, 'payments', 'tx-0092')).toEqual((await readAll(db)).payments.find((p) => p.id === 'tx-0092'))

    expect(await deleteRow(db, 'transactions', 'tx-0001')).toBe(false)
    expect(await deleteRow(db, 'owners', 'own-1')).toBe(true)
    expect(await inspectRecord(db, 'owners', 'own-1')).toBeUndefined()
    await expect(deleteRow(db, 'settings' as never, 'x')).rejects.toThrow('Unknown table "settings".')
  })
})

describe('backup of the new database', () => {
  it('G-06 export then import round-trips identically', async () => {
    const db = freshNewDb()
    await loadDemoData(db)
    const json = await exportNewBackup(db, '2026-11-01T00:00:00.000Z')
    const data = await readAll(db)

    const other = freshNewDb()
    await other.cards.put({ id: 'stale', name: 'Stale', bank: 'X', defaultOwnerId: null })
    await other.meta.put({ key: 'migration', value: 'stale' })
    await importNewBackup(other, json)
    expect(await readAll(other)).toEqual(data)
    expect(await other.meta.count()).toBe(0)
    expect(await exportNewBackup(other, '2026-11-01T00:00:00.000Z')).toBe(json)
    expect(JSON.parse(json)).toMatchObject({ format: 'ccbill-v2-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z' })
  })

  it.each([
    ['{', 'The backup is not valid JSON.'],
    ['null', 'This file is not a CC Bill backup of the new app.'],
    [JSON.stringify({ owners: [] }), 'This file is not a CC Bill backup of the new app.'],
    [JSON.stringify({ format: 'ccbill-v2-backup', version: 2 }), 'Unsupported backup version 2.'],
    [JSON.stringify({ format: 'ccbill-v2-backup', version: 1 }), 'The backup is missing the "cards" list.'],
    [JSON.stringify({ format: 'ccbill-v2-backup', version: 1, data: { cards: [{ name: 'x' }] } }), 'cards[0] has no id.'],
    [JSON.stringify({ format: 'ccbill-v2-backup', version: 1, data: { cards: [null] } }), 'cards[0] has no id.'],
  ])('G-06 rejects a bad backup (%s) and changes nothing', async (json, message) => {
    const db = freshNewDb()
    await db.cards.put({ id: 'keep', name: 'Keep', bank: 'X', defaultOwnerId: null })
    await expect(importNewBackup(db, json)).rejects.toThrow(message)
    expect(await db.cards.count()).toBe(1)
  })
})
