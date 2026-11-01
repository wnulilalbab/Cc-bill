import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { listShares, logShare, sameTarget, shareLogKey } from './shares'

describe('share log (S-05 data)', () => {
  it('logs per card and statement, once per target, amount and day', async () => {
    const db = freshNewDb()
    expect(await listShares(db, 'bca', 'oct')).toEqual([])
    await logShare(db, 'bca', 'oct', { target: { ownerId: 'sari' }, total: 500_000, date: '2026-10-14' })
    await logShare(db, 'bca', 'oct', { target: { ownerId: 'sari' }, total: 500_000, date: '2026-10-14' })
    await logShare(db, 'bca', 'oct', { target: { ownerId: 'sari' }, total: 300_000, date: '2026-10-14' })
    await logShare(db, 'bca', 'oct', { target: { ownerId: 'sari' }, total: 300_000, date: '2026-10-15' })
    await logShare(db, 'bca', 'oct', { target: 'all', total: 300_000, date: '2026-10-15' })
    await logShare(db, 'bca', 'oct', { target: { ownerId: null }, total: 300_000, date: '2026-10-15' })
    await logShare(db, 'bca', 'nov', { target: 'all', total: 1, date: '2026-10-15' })
    expect(await listShares(db, 'bca', 'oct')).toEqual([
      { target: { ownerId: 'sari' }, total: 500_000, date: '2026-10-14' },
      { target: { ownerId: 'sari' }, total: 300_000, date: '2026-10-14' },
      { target: { ownerId: 'sari' }, total: 300_000, date: '2026-10-15' },
      { target: 'all', total: 300_000, date: '2026-10-15' },
      { target: { ownerId: null }, total: 300_000, date: '2026-10-15' },
    ])
    expect(await listShares(db, 'bca', 'nov')).toHaveLength(1)
    expect(await listShares(db, 'mdr', 'oct')).toEqual([])
  })

  it('stores no message text and no phone number', async () => {
    const db = freshNewDb()
    await logShare(db, 'bca', 'oct', { target: 'all', total: 1, date: '2026-10-15' })
    expect(await db.meta.get(shareLogKey('bca', 'oct'))).toEqual({ key: 'shares/bca/oct', value: [{ target: 'all', total: 1, date: '2026-10-15' }] })
  })

  it('skips records it cannot read', async () => {
    const db = freshNewDb()
    await db.meta.put({ key: shareLogKey('bca', 'oct'), value: 'nope' })
    expect(await listShares(db, 'bca', 'oct')).toEqual([])
    const good = { target: { ownerId: 'a' }, total: 5, date: '2026-10-01' }
    await db.meta.put({
      key: shareLogKey('bca', 'oct'),
      value: [null, 3, { target: 'x', total: 1, date: 'd' }, { target: null, total: 1, date: 'd' }, { target: { ownerId: 5 }, total: 1, date: 'd' }, { target: 'all', total: 1.5, date: 'd' }, { target: 'all', total: 1, date: 7 }, good],
    })
    expect(await listShares(db, 'bca', 'oct')).toEqual([good])
  })

  it('compares targets', () => {
    expect(sameTarget('all', 'all')).toBe(true)
    expect(sameTarget('all', { ownerId: 'a' })).toBe(false)
    expect(sameTarget({ ownerId: 'a' }, 'all')).toBe(false)
    expect(sameTarget({ ownerId: 'a' }, { ownerId: 'a' })).toBe(true)
    expect(sameTarget({ ownerId: null }, { ownerId: 'a' })).toBe(false)
  })
})
