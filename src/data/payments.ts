// Payment writes for the Payments screen (docs/intent/phase-1.md §7): save the assign page, record a payment by hand,
// Keep waiting, Paid to another card, Delete. Money rules live in src/domain (allocate.ts, payments.ts, matching.ts);
// each function here reads and writes in one transaction, every write checked.
import { savePayment, type AssignDraft } from '../domain/allocate'
import { countedPayments } from '../domain/amounts'
import { MoneyError } from '../domain/money'
import { applyLinks, matchManualPayments, type PaymentLink } from '../domain/matching'
import { keepWaiting, moveToCard } from '../domain/payments'
import type { Payment } from '../domain/types'
import type { NewDb } from './db'
import { loadLedger } from './repo'
import { checkRecord } from './validate'

export class PaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentError'
  }
}

let seq = 0
/** Id for a new hand-recorded payment. The assign page makes one when it opens, so a repeated Save updates the same payment. */
export const newPaymentId = () => `pay-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const LINKED_LINE = 'This bank line is matched to a payment you recorded. Open that one.'

/** Domain money errors in the user's words. */
export function friendlyMoneyError(e: MoneyError): string {
  if (e.message.startsWith('cannot save')) return 'Assigned more than the payment, or nothing assigned.'
  if (e.message.startsWith('unknown transaction')) return 'A charge on this payment no longer exists. Open the payment again.'
  return 'Enter the amounts in whole rupiah.'
}

async function paymentOrThrow(db: NewDb, id: string): Promise<Payment> {
  const p = await db.payments.get(id)
  if (!p) throw new PaymentError('This payment no longer exists.')
  return p
}

async function checkOwners(db: NewDb, cardId: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const o = await db.owners.get(id)
    if (!o || o.cardId !== cardId) throw new PaymentError('Pick an owner of this card.')
  }
}

/**
 * Hand-recorded payments ↔ bank payment lines of one card (same amount within ±5 days, domain matching). Writes the
 * payments that got a link and returns the links.
 */
async function linkManual(db: NewDb, cardId: string): Promise<PaymentLink[]> {
  const payments = await db.payments.where('cardId').equals(cardId).toArray()
  const links = matchManualPayments(payments)
  const next = applyLinks(payments, links).filter((p, i) => p !== payments[i])
  next.forEach((p) => checkRecord('payments', p))
  await db.payments.bulkPut(next)
  return links
}

export interface SaveResult {
  payment: Payment
  /** The bank line a hand-recorded payment was matched to on this save (counted once). */
  linkedTo?: Payment
}

/**
 * Saves the assign page (domain savePayment). `draft.paymentId` unset = a new hand-recorded payment. The leftover goes
 * to `depositOwnerId`'s deposit, or stays to assign with `null` ("Decide later"). A hand-recorded payment that is not
 * matched yet is then matched to a bank line of the same amount within ±5 days.
 */
export async function saveAssign(
  db: NewDb,
  draft: AssignDraft,
  depositOwnerId: string | null,
  { description, newId }: { description?: string; newId?: string } = {},
): Promise<SaveResult> {
  return db.transaction('rw', [db.payments, db.transactions, db.statements, db.plans, db.owners, db.cards], async () => {
    let base: Payment
    // A new payment saved again (double tap, retry) updates the one already written under its id.
    const again = !draft.paymentId && newId ? await db.payments.get(newId) : undefined
    // Only a hand-recorded payment can be re-saved under its client id; never let it address a bank line.
    if (again && again.source !== 'manual') throw new PaymentError('This payment is on another card now. Open it again.')
    if (draft.paymentId || again) {
      base = again ?? (await paymentOrThrow(db, draft.paymentId!))
      if (base.cardId !== draft.cardId) throw new PaymentError('This payment is on another card now. Open it again.')
    } else {
      if (!(await db.cards.get(draft.cardId))) throw new PaymentError('This card no longer exists.')
      base = { id: newId ?? newPaymentId(), cardId: draft.cardId, source: 'manual', date: draft.date, amount: draft.amount, allocations: [] }
    }
    if (base.source === 'manual' && !ISO_DATE.test(draft.date)) throw new PaymentError('Pick the date you transferred.')
    await checkOwners(db, base.cardId, [...draft.ownerIds, ...(depositOwnerId ? [depositOwnerId] : [])])
    const ledger = await loadLedger(db, base.cardId)
    // A bank line merged into a hand-recorded payment is that payment's money: assigning it too would count it twice.
    if (ledger.payments.some((p) => p.id === base.id) && !countedPayments(ledger.payments).some((p) => p.id === base.id)) throw new PaymentError(LINKED_LINE)
    let next: Payment
    try {
      next = savePayment(ledger, base, { ...draft, paymentId: base.id }, depositOwnerId)
    } catch (e) {
      throw e instanceof MoneyError ? new PaymentError(friendlyMoneyError(e)) : e
    }
    const note = description?.trim()
    if (note) next.description = note.slice(0, 80)
    checkRecord('payments', next)
    await db.payments.put(next)
    if (next.source !== 'manual' || next.linkedStatementLine) return { payment: next }
    const link = (await linkManual(db, next.cardId)).find((l) => l.paymentId === next.id)
    if (!link) return { payment: next }
    return { payment: (await db.payments.get(next.id))!, linkedTo: await db.payments.get(link.lineId) }
  })
}

/** "Keep waiting": a hand-recorded payment the statement doesn't show (or an Unbilled line), checked again next statement. */
export async function keepPaymentWaiting(db: NewDb, id: string): Promise<Payment> {
  return db.transaction('rw', db.payments, async () => {
    const next = keepWaiting(await paymentOrThrow(db, id))
    checkRecord('payments', next)
    await db.payments.put(next)
    return next
  })
}

/**
 * "Paid to another card": moves a hand-recorded payment to `targetCardId` (assignments and deposit cleared, people
 * mapped by name), then matches it against that card's bank lines.
 */
export async function movePayment(db: NewDb, id: string, targetCardId: string): Promise<SaveResult> {
  return db.transaction('rw', [db.payments, db.transactions, db.owners, db.cards], async () => {
    const p = await paymentOrThrow(db, id)
    if (p.source !== 'manual') throw new PaymentError('Only a payment you recorded by hand can move to another card.')
    if (p.linkedStatementLine) throw new PaymentError("This payment is matched to this card's bank line, so it can't move.")
    if (targetCardId === p.cardId) throw new PaymentError('Pick another card.')
    if (!(await db.cards.get(targetCardId))) throw new PaymentError('This card no longer exists.')
    const [transactions, owners] = await Promise.all([db.transactions.where('cardId').equals(p.cardId).toArray(), db.owners.toArray()])
    const next = moveToCard(p, targetCardId, transactions, owners.filter((o) => !o.archived || o.cardId !== targetCardId))
    checkRecord('payments', next)
    await db.payments.put(next)
    const link = (await linkManual(db, targetCardId)).find((l) => l.paymentId === next.id)
    if (!link) return { payment: next }
    return { payment: (await db.payments.get(next.id))!, linkedTo: await db.payments.get(link.lineId) }
  })
}

/**
 * "Transfer failed, delete" / "Delete payment". A payment printed on a statement cannot be deleted (the bank printed
 * it). Its assignments go with it: the charges it paid become unpaid; a bank line it was matched to counts again.
 */
export async function removePayment(db: NewDb, id: string): Promise<void> {
  await db.transaction('rw', db.payments, async () => {
    const p = await paymentOrThrow(db, id)
    if (p.source === 'statement') throw new PaymentError('A payment printed on a statement cannot be deleted.')
    // A hand-recorded payment matched to this (Unbilled) line loses the match and waits for the bank again.
    const linked = (await db.payments.where('cardId').equals(p.cardId).toArray()).filter((x) => x.linkedStatementLine === id)
    const unlinked = linked.map(({ linkedStatementLine: _l, ...rest }) => rest)
    unlinked.forEach((x) => checkRecord('payments', x))
    await db.payments.bulkPut(unlinked)
    await db.payments.delete(id)
  })
}
