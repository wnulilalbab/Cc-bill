// The share log (docs/intent/phase-1.md §9: "Every share is logged; the share sheet shows Sent before with the amount
// sent and 'now X' if it has changed"). Kept in the `meta` table, one record per card + statement, so no schema
// change is needed. Only who, how much and when: never the message text, and never a phone number.
import type { ShareTarget } from '../domain/share/message'
import type { ISODate, Rupiah } from '../domain/types'
import type { NewDb } from './db'

export interface ShareLogEntry {
  target: ShareTarget
  /** What the message asked for when it was sent. */
  total: Rupiah
  date: ISODate
}

/** Entries kept per target (person or everyone) and statement: the oldest go first. */
export const SHARE_LOG_LIMIT = 20

/** Every share-log key of a card starts with this (removed with the card). */
export const shareLogPrefix = (cardId: string) => `shares/${cardId}/`
export const shareLogKey = (cardId: string, statementId: string) => `${shareLogPrefix(cardId)}${statementId}`

export const sameTarget = (a: ShareTarget, b: ShareTarget) =>
  a === 'all' || b === 'all' ? a === b : a.ownerId === b.ownerId

const isEntry = (v: unknown): v is ShareLogEntry => {
  const e = v as ShareLogEntry
  return (
    !!e &&
    typeof e === 'object' &&
    (e.target === 'all' || (typeof e.target === 'object' && e.target !== null && (typeof e.target.ownerId === 'string' || e.target.ownerId === null))) &&
    Number.isSafeInteger(e.total) &&
    typeof e.date === 'string'
  )
}

/** Every share logged for this statement, oldest first. Unreadable records are skipped. */
export async function listShares(db: NewDb, cardId: string, statementId: string): Promise<ShareLogEntry[]> {
  const value = (await db.meta.get(shareLogKey(cardId, statementId)))?.value
  return Array.isArray(value) ? value.filter(isEntry) : []
}

/** Logs a share. The same target, amount and day is logged once; each target keeps its last SHARE_LOG_LIMIT entries. */
export async function logShare(db: NewDb, cardId: string, statementId: string, entry: ShareLogEntry): Promise<void> {
  const key = shareLogKey(cardId, statementId)
  await db.transaction('rw', db.meta, async () => {
    const list = await listShares(db, cardId, statementId)
    if (list.some((x) => sameTarget(x.target, entry.target) && x.total === entry.total && x.date === entry.date)) return
    const next = [...list, entry]
    const drop = new Set(next.filter((x) => sameTarget(x.target, entry.target)).slice(0, -SHARE_LOG_LIMIT))
    await db.meta.put({ key, value: next.filter((x) => !drop.has(x)) })
  })
}
