import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { deleteCard, saveCard, type CardDraft } from './cards'

const CARD = (name: string): CardDraft => ({ name, bank: 'BCA', last4: '', statementDay: '', palette: 'blue', owners: [], defaultIndex: -1 })
import { listShares, logShare, sameTarget, SHARE_LOG_LIMIT, shareLogKey } from './shares'

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

  it('keeps the last 20 entries per target; other targets keep theirs', async () => {
    const db = freshNewDb()
    expect(SHARE_LOG_LIMIT).toBe(20)
    await logShare(db, 'bca', 'oct', { target: 'all', total: 999, date: '2026-10-01' })
    for (let i = 1; i <= 25; i++) await logShare(db, 'bca', 'oct', { target: { ownerId: 'sari' }, total: i, date: '2026-10-02' })
    await logShare(db, 'bca', 'oct', { target: { ownerId: 'bima' }, total: 1, date: '2026-10-03' })
    const list = await listShares(db, 'bca', 'oct')
    expect(list.filter((x) => x.target !== 'all' && x.target.ownerId === 'sari').map((x) => x.total)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6))
    expect(list[0]).toEqual({ target: 'all', total: 999, date: '2026-10-01' })
    expect(list.at(-1)).toEqual({ target: { ownerId: 'bima' }, total: 1, date: '2026-10-03' })
    expect(list).toHaveLength(22)
  })

  it("deleting a card removes its share log, not other cards' logs", async () => {
    const db = freshNewDb()
    const a = await saveCard(db, CARD('Kartu A'))
    const b = await saveCard(db, CARD('Kartu B'))
    for (const card of [a, b]) {
      await logShare(db, card, 'oct', { target: 'all', total: 1, date: '2026-10-01' })
      await logShare(db, card, `${card}-unbilled`, { target: 'all', total: 1, date: '2026-10-01' })
    }
    await logShare(db, `${a}x`, 'oct', { target: 'all', total: 1, date: '2026-10-01' })
    await deleteCard(db, a)
    expect(await listShares(db, a, 'oct')).toEqual([])
    expect(await listShares(db, a, `${a}-unbilled`)).toEqual([])
    expect(await listShares(db, b, 'oct')).toHaveLength(1)
    expect(await listShares(db, `${a}x`, 'oct')).toHaveLength(1)
  })
})
