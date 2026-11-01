import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { feeOwner } from '../domain/bill'
import type { InstallmentPlan, Payment, Transaction } from '../domain/types'
import { freshNewDb } from '../../test/data/oldDb'
import { clearAiCache, AI_CACHE_PREFIX } from './aiCache'
import {
  CardError,
  cardHasHistory,
  deleteCard,
  draftProblem,
  listCards,
  ownersWithHistory,
  saveCard,
  setHolderName,
  sortOwners,
  unbilledIdOf,
  type CardDraft,
  type OwnerRecord,
} from './cards'
import { exportNewBackup } from './backup'

const draft = (p: Partial<CardDraft> = {}): CardDraft => ({
  name: 'Test Card',
  bank: 'BNI',
  last4: '1234',
  statementDay: '12',
  palette: 'green',
  owners: [
    { name: 'Alpha', color: '#2563eb' },
    { name: 'Beta', color: '#db2777' },
  ],
  defaultIndex: 0,
  ...p,
})

const tx = (id: string, cardId: string, ownerId: string): Transaction => ({ id, cardId, statementId: unbilledIdOf(cardId), date: '2026-10-01', description: 'SHOP', amount: 1000, kind: 'purchase', ownerId })

async function ownersOf(db: ReturnType<typeof freshNewDb>, cardId: string) {
  return sortOwners((await db.owners.where('cardId').equals(cardId).toArray()) as OwnerRecord[])
}

describe('cards and owners (data)', () => {
  it('C-01 a new card gets its own Unbilled bucket and its own owner list', async () => {
    const db = freshNewDb()
    const a = await saveCard(db, draft())
    const b = await saveCard(db, draft({ name: 'Other', owners: [{ name: 'Alpha', color: '#2563eb' }] }))
    expect(a).not.toBe(b)
    expect(await db.statements.get(unbilledIdOf(a))).toEqual({ id: unbilledIdOf(a), cardId: a, kind: 'unbilled' })
    expect(await db.statements.get(unbilledIdOf(b))).toBeTruthy()
    const ownersA = await ownersOf(db, a)
    const ownersB = await ownersOf(db, b)
    expect(ownersA.map((o) => o.name)).toEqual(['Alpha', 'Beta'])
    expect(ownersB.map((o) => o.name)).toEqual(['Alpha'])
    expect(ownersA[0].id).not.toBe(ownersB[0].id)
    const card = await db.cards.get(a)
    expect(card).toMatchObject({ name: 'Test Card', bank: 'BNI', last4: '1234', statementDay: 12, palette: 'green', defaultOwnerId: ownersA[0].id })
  })

  it('C-01 optional fields stay unset and names are trimmed', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft({ name: '  Spaced  ', last4: '', statementDay: '', owners: [{ name: ' Gamma ', color: '#000000' }], defaultIndex: -1 }))
    const card = await db.cards.get(id)
    expect(card).toEqual({ id, name: 'Spaced', bank: 'BNI', defaultOwnerId: null, palette: 'green' })
    expect((await ownersOf(db, id))[0].name).toBe('Gamma')
  })

  it('C-05 default owner None leaves fees and unmatched rows to Check', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft({ defaultIndex: -1 }))
    const card = (await db.cards.get(id))!
    expect(card.defaultOwnerId).toBeNull()
    expect(feeOwner(card)).toEqual({ ownerId: null, check: true })
    const id2 = await saveCard(db, draft({ defaultIndex: 1 }))
    const card2 = (await db.cards.get(id2))!
    expect(feeOwner(card2).check).toBe(false)
  })

  it('rejects invalid drafts with a plain message', async () => {
    expect(draftProblem(draft({ name: ' ' }))).toBe('Give the card a name.')
    expect(draftProblem(draft({ last4: '12a4' }))).toBe('Last 4 digits must be 4 numbers.')
    expect(draftProblem(draft({ last4: '123' }))).toBe('Last 4 digits must be 4 numbers.')
    expect(draftProblem(draft({ statementDay: '32' }))).toMatch(/Statement day/)
    expect(draftProblem(draft({ statementDay: '0' }))).toMatch(/Statement day/)
    expect(draftProblem(draft({ statementDay: '1.5' }))).toMatch(/Statement day/)
    expect(draftProblem(draft({ owners: [{ name: '', color: '#000' }] }))).toBe('Every owner needs a name.')
    expect(draftProblem(draft({ owners: [{ name: 'A', color: '#000' }, { name: ' a ', color: '#000' }] }))).toBe('There are two owners called "a".')
    expect(draftProblem(draft({ defaultIndex: 5 }))).toBe('Pick the default owner again.')
    expect(draftProblem(draft({ defaultIndex: -2 }))).toBe('Pick the default owner again.')
    expect(draftProblem(draft({ owners: [{ name: 'A', color: '#000', archived: true }], defaultIndex: 0 }))).toMatch(/archived owner/)
    expect(draftProblem(draft())).toBeNull()
    await expect(saveCard(freshNewDb(), draft({ name: '' }))).rejects.toThrow(CardError)
  })

  it('C-03 an owner without history is removed; renames and new owners are saved in order', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft())
    const [alpha, beta] = await ownersOf(db, id)
    await saveCard(db, draft({ id, owners: [{ id: beta.id, name: 'Beta renamed', color: '#db2777' }, { name: 'Delta', color: '#ca8a04' }], defaultIndex: 1 }))
    const after = await ownersOf(db, id)
    expect(after.map((o) => o.name)).toEqual(['Beta renamed', 'Delta'])
    expect(after.some((o) => o.id === alpha.id)).toBe(false)
    expect((await db.cards.get(id))!.defaultOwnerId).toBe(after[1].id)
    expect(await db.statements.where('cardId').equals(id).count()).toBe(1) // no second Unbilled on edit
  })

  it('C-04 an owner with history cannot be removed, only archived (and restored)', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft())
    const [alpha, beta] = await ownersOf(db, id)
    await db.transactions.put(tx('t1', id, alpha.id))
    expect(await ownersWithHistory(db, id)).toEqual(new Set([alpha.id]))
    await expect(saveCard(db, draft({ id, owners: [{ id: beta.id, name: 'Beta', color: '#000' }], defaultIndex: 0 }))).rejects.toThrow('Alpha has history. Archive them instead.')
    expect((await ownersOf(db, id)).length).toBe(2)

    await saveCard(db, draft({ id, owners: [{ id: alpha.id, name: 'Alpha', color: '#000', archived: true }, { id: beta.id, name: 'Beta', color: '#000' }], defaultIndex: 1 }))
    expect((await db.owners.get(alpha.id))!.archived).toBe(true)
    await saveCard(db, draft({ id, owners: [{ id: alpha.id, name: 'Alpha', color: '#000' }, { id: beta.id, name: 'Beta', color: '#000' }], defaultIndex: 1 }))
    expect((await db.owners.get(alpha.id))!.archived).toBeUndefined()
    expect((await db.transactions.get('t1'))!.ownerId).toBe(alpha.id) // history kept
  })

  it('C-04 plans and payments (deposit, people it was for) count as history', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft({ owners: ['A', 'B', 'C', 'D'].map((name) => ({ name, color: '#000' })) }))
    const [a, b, c] = await ownersOf(db, id)
    const plan: InstallmentPlan = { id: 'pl1', cardId: id, ownerId: a.id, name: 'Plan', monthly: 1000, total: 3, start: '2026-10' }
    const pay: Payment = { id: 'p1', cardId: id, source: 'manual', date: '2026-10-02', amount: 5000, allocations: [], depositOwnerId: b.id, forOwnerIds: [c.id] }
    const pay2: Payment = { id: 'p2', cardId: id, source: 'manual', date: '2026-10-02', amount: 5000, allocations: [] }
    await db.plans.put(plan)
    await db.payments.bulkPut([pay, pay2])
    await db.transactions.put({ ...tx('t0', id, a.id), ownerId: null })
    expect(await ownersWithHistory(db, id)).toEqual(new Set([a.id, b.id, c.id]))
  })

  it('refuses ids that do not belong to the card', async () => {
    const db = freshNewDb()
    const a = await saveCard(db, draft())
    const b = await saveCard(db, draft({ name: 'B' }))
    const [ownerA] = await ownersOf(db, a)
    await expect(saveCard(db, draft({ id: b, owners: [{ id: ownerA.id, name: 'X', color: '#000' }] }))).rejects.toThrow('Owner X is not on this card.')
    await expect(saveCard(db, draft({ id: 'card-missing' }))).rejects.toThrow('This card no longer exists.')
  })

  it('deletes an unused card with its owners and Unbilled; refuses a card with history', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, draft())
    expect(await cardHasHistory(db, id)).toBe(false)
    await deleteCard(db, id)
    expect(await db.cards.get(id)).toBeUndefined()
    expect(await db.owners.count()).toBe(0)
    expect(await db.statements.count()).toBe(0)

    const used = await saveCard(db, draft())
    const [o] = await ownersOf(db, used)
    await db.transactions.put(tx('t1', used, o.id))
    expect(await cardHasHistory(db, used)).toBe(true)
    await expect(deleteCard(db, used)).rejects.toThrow('cannot be deleted')
    expect(await db.cards.get(used)).toBeTruthy()
  })

  it('lists cards by name with their owners in list order', async () => {
    const db = freshNewDb()
    const z = await saveCard(db, draft({ name: 'Zeta' }))
    await saveCard(db, draft({ name: 'Alpha card' }))
    await db.owners.put({ id: 'aaa-migrated', cardId: z, name: 'Migrated' })
    const list = await listCards(db)
    expect(list.map((c) => c.card.name)).toEqual(['Alpha card', 'Zeta'])
    expect(list[1].owners.map((o) => o.name)).toEqual(['Alpha', 'Beta', 'Migrated'])
    expect(sortOwners([{ id: 'b', cardId: z, name: 'B' }, { id: 'a', cardId: z, name: 'A' }]).map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('palette and owner colours travel with the cards in the backup', async () => {
    const db = freshNewDb()
    await saveCard(db, draft({ palette: 'rose' }))
    const json = JSON.parse(await exportNewBackup(db))
    expect(json.data.cards[0].palette).toBe('rose')
    expect(json.data.owners[0].color).toBe('#2563eb')
  })
})

describe('AI cache (testing tool)', () => {
  it('G-05 clear AI cache removes only cached AI responses', async () => {
    const db = freshNewDb()
    await db.meta.bulkPut([
      { key: `${AI_CACHE_PREFIX}abc:v1`, value: '{}' },
      { key: `${AI_CACHE_PREFIX}def:v1`, value: '{}' },
      { key: 'migration', value: {} },
    ])
    expect(await clearAiCache(db)).toBe(2)
    expect((await db.meta.toArray()).map((m) => m.key)).toEqual(['migration'])
    expect(await clearAiCache(db)).toBe(0)
  })
})

describe('holder name (first PDF import)', () => {
  it('I-05 setHolderName stores the trimmed name; empty text changes nothing; a missing card is an error', async () => {
    const db = freshNewDb()
    await db.cards.put({ id: 'c1', name: 'Synthetic', bank: 'BCA', defaultOwnerId: null })
    await setHolderName(db, 'c1', '   ')
    expect(((await db.cards.get('c1')) as { holderName?: string }).holderName).toBeUndefined()
    await setHolderName(db, 'c1', ' Andi Pratama ')
    expect(((await db.cards.get('c1')) as { holderName?: string }).holderName).toBe('Andi Pratama')
    await expect(setHolderName(db, 'gone', 'X')).rejects.toThrow(new CardError('This card no longer exists.'))
  })
})
