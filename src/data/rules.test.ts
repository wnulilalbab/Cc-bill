import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { TagRule } from '../domain/tagging/types'
import type { Transaction } from '../domain/types'
import { freshNewDb, uniqueName } from '../../test/data/oldDb'
import { exportNewBackup, parseNewBackup } from './backup'
import { deleteCard } from './cards'
import { NewDb } from './db'
import { applyMigration, deleteOldData } from './migration'
import {
  applyRuleOnCard,
  deleteRule,
  dismissSuggestion,
  DISMISSED_PREFIX,
  labelHistory,
  listDismissals,
  listRules,
  previewRuleOnCard,
  RuleError,
  saveRule,
  setOwner,
} from './rules'
import { checkRecord, RecordError } from './validate'

const NOW = '2026-10-20T08:00:00.000Z'

async function seed() {
  const db = freshNewDb()
  await db.cards.bulkPut([
    { id: 'A', name: 'Card A', bank: 'BCA', defaultOwnerId: 'a-andi' },
    { id: 'B', name: 'Card B', bank: 'Mandiri', defaultOwnerId: null },
  ])
  await db.owners.bulkPut([
    { id: 'a-andi', cardId: 'A', name: 'Andi' },
    { id: 'a-sari', cardId: 'A', name: 'Sari' },
    { id: 'a-bima', cardId: 'A', name: 'Bima', archived: true },
    { id: 'b-andi', cardId: 'B', name: 'Andi' },
  ])
  return db
}
const tx = (id: string, description: string, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id, cardId: 'A', statementId: 's', date: '2026-10-01', description, amount: 9000, kind: 'purchase', ownerId, ...extra,
})

describe('tagging rules (data)', () => {
  it('T-06 saves a rule for that card only, upper-cased; the same pattern replaces the owner instead of adding a rule', async () => {
    const db = await seed()
    const r = await saveRule(db, { cardId: 'A', match: 'startsWith', pattern: ' grab* ', ownerId: 'a-andi' }, { now: NOW })
    expect(r).toMatchObject({ cardId: 'A', match: 'startsWith', pattern: 'GRAB*', ownerId: 'a-andi', updatedAt: NOW, origin: 'you' })
    const again = await saveRule(db, { cardId: 'A', match: 'startsWith', pattern: 'GRAB*', ownerId: 'a-sari' }, { now: NOW, origin: 'analyze' })
    expect(again.id).toBe(r.id)
    expect(await listRules(db, 'A')).toEqual([{ ...r, ownerId: 'a-sari', origin: 'analyze' }])
    expect(await listRules(db, 'B')).toEqual([])
  })

  it('editing a rule into the pattern of another one merges them', async () => {
    const db = await seed()
    const a = await saveRule(db, { cardId: 'A', match: 'contains', pattern: 'NETFLIX', ownerId: 'a-andi' })
    const b = await saveRule(db, { cardId: 'A', match: 'contains', pattern: 'KCI', ownerId: 'a-andi' })
    await saveRule(db, { id: b.id, cardId: 'A', match: 'contains', pattern: 'netflix', ownerId: 'a-sari' })
    expect((await listRules(db, 'A')).map((x) => [x.id, x.ownerId])).toEqual([[a.id, 'a-sari']])
    await saveRule(db, { id: a.id, cardId: 'A', match: 'startsWith', pattern: 'NETFLIX', ownerId: 'a-sari' })
    expect((await listRules(db, 'A')).map((x) => [x.id, x.match])).toEqual([[a.id, 'startsWith']])
  })

  it('refuses owners of another card, archived owners and missing rules; deletes', async () => {
    const db = await seed()
    await expect(saveRule(db, { cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'b-andi' })).rejects.toThrow(RuleError)
    await expect(saveRule(db, { cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'a-bima' })).rejects.toThrow('Bima is archived. Pick another owner.')
    await expect(saveRule(db, { id: 'gone', cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'a-sari' })).rejects.toThrow('This rule no longer exists.')
    const r = await saveRule(db, { cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'a-sari' })
    await deleteRule(db, r.id)
    expect(await listRules(db, 'A')).toEqual([])
  })

  it('lists rules by pattern, then match', async () => {
    const db = await seed()
    await saveRule(db, { cardId: 'A', match: 'startsWith', pattern: 'KCI', ownerId: 'a-sari' })
    await saveRule(db, { cardId: 'A', match: 'contains', pattern: 'KCI', ownerId: 'a-sari' })
    await saveRule(db, { cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'a-sari' })
    expect((await listRules(db, 'A')).map((r) => `${r.match} ${r.pattern}`)).toEqual(['contains GRAB', 'contains KCI', 'startsWith KCI'])
  })

  it('T-06 preview counts, then confirm: only Check or unowned rows change unless the user opts in; T-09 other cards untouched', async () => {
    const db = await seed()
    await db.transactions.bulkPut([
      tx('t1', 'GRAB* A-1', 'a-andi', { check: true }),
      tx('t2', 'GRAB* A-2', null),
      tx('t3', 'GRAB* A-3', 'a-andi', { tagSource: 'manual' }),
      tx('t4', 'GRAB* A-4', 'a-sari'),
      tx('t5', 'GRAB* A-5', null),
      tx('b1', 'GRAB* B-1', null, { cardId: 'B' }),
    ])
    const rule = await saveRule(db, { cardId: 'A', match: 'startsWith', pattern: 'GRAB*', ownerId: 'a-sari' })
    const p = await previewRuleOnCard(db, rule, 't5')
    expect({ unsure: p.unsure.map((t) => t.id), owned: p.owned.map((t) => t.id), ownedManual: p.ownedManual }).toEqual({ unsure: ['t1', 't2'], owned: ['t3'], ownedManual: 1 })

    expect(await applyRuleOnCard(db, rule, { except: 't5' })).toBe(2)
    expect(await db.transactions.get('t1')).toEqual(tx('t1', 'GRAB* A-1', 'a-sari', { tagSource: 'rule' }))
    expect((await db.transactions.get('t3'))?.ownerId).toBe('a-andi')
    expect((await db.transactions.get('t5'))?.ownerId).toBeNull()
    expect((await db.transactions.get('b1'))?.ownerId).toBeNull()

    expect(await applyRuleOnCard(db, rule, { includeOwned: true })).toBe(2) // t3 (opted in) and t5
    expect(await db.transactions.get('t3')).toMatchObject({ ownerId: 'a-sari', tagSource: 'rule' })
    expect(await applyRuleOnCard(db, rule)).toBe(0)
  })

  it('T-06 the tag sheet sets one owner by hand: source You, Check cleared; refuses bad owners', async () => {
    const db = await seed()
    await db.transactions.put(tx('t1', 'SHOPEE 1', 'a-andi', { check: true, tagSource: 'default' }))
    expect(await setOwner(db, 't1', 'a-sari')).toEqual(tx('t1', 'SHOPEE 1', 'a-sari', { tagSource: 'manual' }))
    expect(await setOwner(db, 't1', null)).toMatchObject({ ownerId: null, tagSource: 'manual' })
    await expect(setOwner(db, 't1', 'b-andi')).rejects.toThrow('Pick an owner of this card.')
    await expect(setOwner(db, 't1', 'nobody')).rejects.toThrow('Pick an owner of this card.')
    await expect(setOwner(db, 't1', 'a-bima')).rejects.toThrow('Bima is archived. Pick another owner.')
    await expect(setOwner(db, 'gone', 'a-sari')).rejects.toThrow('This transaction no longer exists.')
    expect((await labelHistory(db, 'A')).map((t) => t.ownerId)).toEqual([null])
  })

  it('T-08 remembers dismissed suggestions with a trimmed comment, per card', async () => {
    const db = await seed()
    expect(await listDismissals(db, 'A')).toEqual([])
    await dismissSuggestion(db, 'A', { match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-sari', comment: '  Books are for Bima  ', at: NOW })
    await dismissSuggestion(db, 'A', { match: 'contains', pattern: 'KCI', ownerId: 'a-sari', comment: '  ', at: NOW })
    expect(await listDismissals(db, 'A')).toEqual([
      { match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-sari', comment: 'Books are for Bima', at: NOW },
      { match: 'contains', pattern: 'KCI', ownerId: 'a-sari', at: NOW },
    ])
    expect(await listDismissals(db, 'B')).toEqual([])
    await db.meta.put({ key: DISMISSED_PREFIX + 'B', value: 'broken' })
    expect(await listDismissals(db, 'B')).toEqual([])
  })
})

describe('rules in the database schema', () => {
  const rule: TagRule = { id: 'r1', cardId: 'A', match: 'contains', pattern: 'GRAB', ownerId: 'a-andi', updatedAt: NOW }

  it('checkRecord validates rules and the tag source of transactions', () => {
    expect(() => checkRecord('rules', rule)).not.toThrow()
    expect(() => checkRecord('rules', { ...rule, match: 'equals' as never })).toThrow('rule r1 match must be one of startsWith, contains')
    expect(() => checkRecord('rules', { ...rule, pattern: '   ' })).toThrow('rule r1 pattern must be a non-empty text')
    expect(() => checkRecord('rules', { ...rule, ownerId: '' })).toThrow('rule r1 ownerId must be a non-empty text')
    expect(() => checkRecord('rules', { ...rule, updatedAt: undefined as never })).toThrow(RecordError)
    expect(() => checkRecord('rules', { ...rule, cardId: '' })).toThrow('rule r1 cardId must be a non-empty text')
    expect(() => checkRecord('transactions', { ...tx('t', 'X', null), tagSource: 'rule' })).not.toThrow()
    expect(() => checkRecord('transactions', { ...tx('t', 'X', null), tagSource: 'robot' as never })).toThrow('transaction t tagSource must be one of manual, rule, auto, ai, default, plan')
  })

  it('opening a version-1 database adds the rules table and keeps the data', async () => {
    const name = uniqueName('ccbill-v2')
    const v1 = new Dexie(name)
    v1.version(1).stores({ cards: '&id, name', owners: '&id, cardId', statements: '&id, cardId, kind, statementDate', transactions: '&id, cardId, statementId, date, ownerId, planId', payments: '&id, cardId, source, statementId, date', plans: '&id, cardId', meta: '&key' })
    await v1.open()
    await v1.table('cards').put({ id: 'A', name: 'Card A', bank: 'BCA', defaultOwnerId: null })
    v1.close()
    const db = new NewDb(name)
    expect(await db.cards.count()).toBe(1)
    await db.rules.put(rule)
    expect(db.verno).toBe(2)
    expect(await db.rules.where('cardId').equals('A').count()).toBe(1)
  })

  it('G-06 backups carry the rules; a backup from before rules existed reads as no rules', async () => {
    const db = await seed()
    await db.rules.put(rule)
    const json = await exportNewBackup(db, NOW)
    expect(parseNewBackup(json).rules).toEqual([rule])
    const old = JSON.parse(json)
    delete old.data.rules
    expect(parseNewBackup(JSON.stringify(old)).rules).toEqual([])
  })

  it('deleting an unused card deletes its rules', async () => {
    const db = await seed()
    await db.rules.bulkPut([rule, { ...rule, id: 'r2', cardId: 'B', ownerId: 'b-andi' }])
    await deleteCard(db, 'A')
    expect((await db.rules.toArray()).map((r) => r.id)).toEqual(['r2'])
  })

  it('a migration record written before rules existed is still handled (re-run and delete-old checks)', async () => {
    const db = await seed()
    await db.meta.put({ key: 'migration', value: { ranAt: NOW, oldFingerprint: 'x', ids: { cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [] } } })
    await db.meta.put({ key: 'verification', value: { ok: true, at: NOW, oldFingerprint: 'x', differences: [] } })
    await expect(deleteOldData(db, { oldName: uniqueName('none'), beforeDelete: () => {} })).rejects.toThrow('There is no old data to delete.')
    const empty = { cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [], rules: [] }
    await applyMigration(db, { data: empty, oldFingerprint: 'y' } as never, NOW)
    expect((await db.meta.get('migration'))?.value).toMatchObject({ ids: { rules: [] } })
  })
})
