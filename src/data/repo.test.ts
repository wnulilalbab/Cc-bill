import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoneyError } from '../domain/money'
import type { Payment, Transaction } from '../domain/types'
import { freshNewDb } from '../../test/data/oldDb'
import { getNewDb, NewDb } from './db'
import { appEnv, newDbName, oldDbName } from './env'
import { loadLedger, readAll, repos } from './repo'

const tx = (id: string, cardId = 'c1', statementId = 's1'): Transaction => ({ id, cardId, statementId, date: '2026-08-01', description: id, amount: 1000, kind: 'purchase', ownerId: 'o1' })
const pay = (id: string, amount = 500): Payment => ({ id, cardId: 'c1', source: 'manual', date: '2026-08-02', amount, allocations: [{ txId: 't1', amount: 500 }] })

describe('database names', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('G-05 staging and production use different databases, old and new', () => {
    expect(newDbName('production')).toBe('ccbill-v2')
    expect(newDbName('staging')).toBe('ccbill-v2-staging')
    expect(oldDbName('production')).toBe('CCBillDB')
    expect(oldDbName('staging')).toBe('CCBillDB-staging')
  })

  it('G-05 defaults to the build environment, production when it is not defined', () => {
    expect(appEnv()).toBe('production')
    vi.stubGlobal('__APP_ENV__', 'staging')
    expect(appEnv()).toBe('staging')
    expect(newDbName()).toBe('ccbill-v2-staging')
    expect(new NewDb().name).toBe('ccbill-v2-staging')
    vi.stubGlobal('__APP_ENV__', 'production')
    expect(oldDbName()).toBe('CCBillDB')
  })

  it('G-05 getNewDb returns one shared database', () => {
    expect(getNewDb()).toBe(getNewDb())
    expect(getNewDb().name).toBe('ccbill-v2')
  })
})

describe('repositories', () => {
  it('G-06 CRUD on every table, scoped by card', async () => {
    const db = freshNewDb()
    const r = repos(db)
    await r.cards.put({ id: 'c1', name: 'BCA Shared', bank: 'BCA', defaultOwnerId: null })
    await r.owners.put({ id: 'o1', cardId: 'c1', name: 'Andi' })
    await r.owners.put({ id: 'o2', cardId: 'c2', name: 'Rumah' })
    await r.statements.put({ id: 's1', cardId: 'c1', kind: 'unbilled' })
    await r.transactions.put(tx('t1'))
    await r.transactions.put(tx('t2', 'c1', 's2'))
    await r.payments.put(pay('p1'))
    await r.plans.put({ id: 'pl1', cardId: 'c1', ownerId: 'o1', name: 'Plan', monthly: 100, total: 3, start: '2026-08' })

    expect(await r.cards.get('c1')).toMatchObject({ name: 'BCA Shared' })
    expect(await r.cards.list()).toHaveLength(1)
    expect((await r.owners.byCard('c1')).map((o) => o.id)).toEqual(['o1'])
    expect((await r.transactions.byStatement('s2')).map((t) => t.id)).toEqual(['t2'])
    expect(await loadLedger(db, 'c1')).toEqual({
      statements: [{ id: 's1', cardId: 'c1', kind: 'unbilled' }],
      transactions: [tx('t1'), tx('t2', 'c1', 's2')],
      payments: [pay('p1')],
      plans: [{ id: 'pl1', cardId: 'c1', ownerId: 'o1', name: 'Plan', monthly: 100, total: 3, start: '2026-08' }],
    })
    await r.owners.remove('o2')
    expect(await r.owners.get('o2')).toBeUndefined()
    const all = await readAll(db)
    expect(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]))).toEqual({ cards: 1, owners: 1, statements: 1, transactions: 2, payments: 1, plans: 1 })
  })

  it('G-06 refuses money that is not integer rupiah', async () => {
    const r = repos(freshNewDb())
    await expect(r.transactions.put({ ...tx('t1'), amount: 10.5 })).rejects.toThrow(MoneyError)
    await expect(r.payments.put(pay('p1', 0))).rejects.toThrow('payment p1 amount must be positive, got 0')
    await expect(r.plans.put({ id: 'pl', cardId: 'c1', ownerId: null, name: 'x', monthly: 1.2, total: 1, start: '2026-08' })).rejects.toThrow('plan pl monthly amount')
    expect(await r.transactions.list()).toEqual([])
  })
})
