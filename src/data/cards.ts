// Cards and their owners (Settings → Cards). Each card has its own owner list and its own Unbilled bucket.
import type { Card, Owner, UnbilledStatement } from '../domain/types'
import type { NewDb } from './db'
import { DISMISSED_PREFIX } from './rules'
import { pdfPasswordKey } from './deviceSecrets'

/** A card as stored: the domain card plus its look. */
export interface CardRecord extends Card {
  /** Palette id (see src/features/look/palettes.ts). Unset = the first palette. */
  palette?: string
  /** Card holder's name as printed on statements: removed from the text before it goes to the AI. */
  holderName?: string
}

/** An owner as stored: the domain owner plus its chip colour. */
export interface OwnerRecord extends Owner {
  color?: string
  /** Position in the card's owner list. */
  order?: number
}

export class CardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardError'
  }
}

export interface OwnerDraft {
  /** Unset for an owner added in this edit. */
  id?: string
  name: string
  color: string
  archived?: boolean
}

export interface CardDraft {
  /** Unset when adding a card. */
  id?: string
  name: string
  bank: string
  last4: string
  /** Card holder's name as printed on statements (optional; unset = keep the current one when absent from the draft). */
  holderName?: string
  /** Empty = not set. */
  statementDay: string
  palette: string
  owners: OwnerDraft[]
  /** Index into `owners` of the default owner; -1 = "None". */
  defaultIndex: number
}

export const unbilledIdOf = (cardId: string) => `${cardId}-unbilled`

let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Ids of the owners on a card that have history (rows, plans or payments), which can only be archived. */
export async function ownersWithHistory(db: NewDb, cardId: string): Promise<Set<string>> {
  const [txs, plans, payments] = await Promise.all([
    db.transactions.where('cardId').equals(cardId).toArray(),
    db.plans.where('cardId').equals(cardId).toArray(),
    db.payments.where('cardId').equals(cardId).toArray(),
  ])
  const ids = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id)
  }
  txs.forEach((t) => add(t.ownerId))
  plans.forEach((p) => add(p.ownerId))
  payments.forEach((p) => {
    add(p.depositOwnerId)
    p.forOwnerIds?.forEach(add)
  })
  return ids
}

/** True when the card holds any transaction, payment or installment plan. */
export async function cardHasHistory(db: NewDb, cardId: string): Promise<boolean> {
  const counts = await Promise.all([
    db.transactions.where('cardId').equals(cardId).count(),
    db.payments.where('cardId').equals(cardId).count(),
    db.plans.where('cardId').equals(cardId).count(),
  ])
  return counts.some((n) => n > 0)
}

/** Checks a draft; returns the first problem in plain English, or null. */
export function draftProblem(d: CardDraft): string | null {
  if (!d.name.trim()) return 'Give the card a name.'
  if (d.last4 !== '' && !/^\d{4}$/.test(d.last4)) return 'Last 4 digits must be 4 numbers.'
  if (d.statementDay !== '') {
    const n = Number(d.statementDay)
    if (!Number.isInteger(n) || n < 1 || n > 31) return 'Statement day must be a day of the month (1–31).'
  }
  const seen = new Set<string>()
  for (const o of d.owners) {
    const key = o.name.trim().toLowerCase()
    if (!key) return 'Every owner needs a name.'
    if (seen.has(key)) return `There are two owners called "${o.name.trim()}".`
    seen.add(key)
  }
  if (d.defaultIndex >= d.owners.length || d.defaultIndex < -1) return 'Pick the default owner again.'
  if (d.defaultIndex >= 0 && d.owners[d.defaultIndex].archived) return 'An archived owner cannot be the default owner.'
  return null
}

/** Adds or updates a card with its owners, in one transaction. Returns the card id. */
export async function saveCard(db: NewDb, d: CardDraft): Promise<string> {
  const problem = draftProblem(d)
  if (problem) throw new CardError(problem)
  return db.transaction('rw', [db.cards, db.owners, db.statements, db.transactions, db.plans, db.payments], async () => {
    const existing = d.id ? await db.cards.get(d.id) : undefined
    if (d.id && !existing) throw new CardError('This card no longer exists.')
    const cardId = existing?.id ?? newId('card')

    const before = (await db.owners.where('cardId').equals(cardId).toArray()) as OwnerRecord[]
    const kept = new Set(d.owners.flatMap((o) => (o.id ? [o.id] : [])))
    const removed = before.filter((o) => !kept.has(o.id))
    if (removed.length) {
      const history = await ownersWithHistory(db, cardId)
      const blocked = removed.find((o) => history.has(o.id))
      if (blocked) throw new CardError(`${blocked.name} has history. Archive them instead.`)
      await db.owners.bulkDelete(removed.map((o) => o.id))
    }

    const beforeIds = new Set(before.map((o) => o.id))
    const owners: OwnerRecord[] = d.owners.map((o, order) => {
      if (o.id && !beforeIds.has(o.id)) throw new CardError(`Owner ${o.name} is not on this card.`)
      const rec: OwnerRecord = { id: o.id ?? newId('owner'), cardId, name: o.name.trim(), color: o.color, order }
      if (o.archived) rec.archived = true
      return rec
    })
    await db.owners.bulkPut(owners)

    const card: CardRecord = {
      id: cardId,
      name: d.name.trim(),
      bank: d.bank,
      defaultOwnerId: d.defaultIndex >= 0 ? owners[d.defaultIndex].id : null,
      palette: d.palette,
    }
    if (d.last4) card.last4 = d.last4
    const holder = d.holderName === undefined ? (existing as CardRecord | undefined)?.holderName : d.holderName.trim()
    if (holder) card.holderName = holder
    if (d.statementDay) card.statementDay = Number(d.statementDay)
    await db.cards.put(card)

    if (!existing) {
      const unbilled: UnbilledStatement = { id: unbilledIdOf(cardId), cardId, kind: 'unbilled' }
      await db.statements.put(unbilled)
    }
    return cardId
  })
}

/** Deletes a card that has no history, with its owners, its (empty) statements, its rules and dismissed suggestions, and its remembered PDF password. */
export async function deleteCard(db: NewDb, cardId: string): Promise<void> {
  await db.transaction('rw', [db.cards, db.owners, db.statements, db.transactions, db.plans, db.payments, db.rules, db.meta], async () => {
    if (await cardHasHistory(db, cardId)) throw new CardError('This card has transactions or payments, so it cannot be deleted.')
    await db.owners.where('cardId').equals(cardId).delete()
    await db.rules.where('cardId').equals(cardId).delete()
    await db.meta.delete(DISMISSED_PREFIX + cardId)
    await db.statements.where('cardId').equals(cardId).delete()
    await db.meta.delete(pdfPasswordKey(cardId)) // its remembered PDF password goes with it
    await db.cards.delete(cardId)
  })
}

export interface CardWithOwners {
  card: CardRecord
  owners: OwnerRecord[]
}

/** Every card with its owners, cards by name. */
export async function listCards(db: NewDb): Promise<CardWithOwners[]> {
  const [cards, owners] = await Promise.all([db.cards.toArray(), db.owners.toArray()])
  return (cards as CardRecord[])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((card) => ({ card, owners: sortOwners((owners as OwnerRecord[]).filter((o) => o.cardId === card.id)) }))
}

/** Owners in list order; owners without a position (e.g. migrated) keep id order after them. */
export function sortOwners(owners: OwnerRecord[]): OwnerRecord[] {
  const pos = (o: OwnerRecord) => o.order ?? Number.MAX_SAFE_INTEGER
  return owners.slice().sort((a, b) => pos(a) - pos(b) || a.id.localeCompare(b.id))
}
