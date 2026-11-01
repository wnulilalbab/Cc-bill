import { computeMoney, effective, remainingOf, type MoneyState } from './amounts'
import { assertRupiah, MoneyError, sum } from './money'
import { canEditAmountAndDate } from './payments'
import { statementSortKey } from './statements'
import type { Allocation, ISODate, Ledger, Payment, Rupiah, Transaction } from './types'

/** State of the full-screen assign page. */
export interface AssignDraft {
  /** Payment being edited: its own assignments and deposit are left out of the open amounts. */
  paymentId?: string
  cardId: string
  date: ISODate
  amount: Rupiah
  /** Who the payment is for. */
  ownerIds: string[]
  /** "It was for more than one person". */
  multi: boolean
  /** txId → assigned amount, in tap order. */
  allocations: Record<string, Rupiah>
}

export function draftFromPayment(p: Payment, transactions: readonly Transaction[]): AssignDraft {
  const allocations: Record<string, Rupiah> = {}
  for (const a of p.allocations) allocations[a.txId] = (allocations[a.txId] ?? 0) + a.amount
  const owners: string[] = [...(p.forOwnerIds ?? [])]
  for (const a of p.allocations) {
    const o = transactions.find((t) => t.id === a.txId)?.ownerId
    if (o && !owners.includes(o)) owners.push(o)
  }
  return { paymentId: p.id, cardId: p.cardId, date: p.date, amount: p.amount, ownerIds: owners, multi: owners.length > 1, allocations }
}

export interface CandidateItem {
  txId: string
  ownerId: string | null
  date: ISODate
  /** Open amount not counting this payment. */
  open: Rupiah
  assigned: Rupiah
}

export interface CandidateGroup {
  statementId: string
  items: CandidateItem[]
  openTotal: Rupiah
}

export interface Candidates {
  /** Oldest statement first, Unbilled last. */
  groups: CandidateGroup[]
  /** Hidden: charges dated after the payment date. */
  hiddenLater: number
  /** Hidden: charges already fully paid by other payments. */
  hiddenPaid: number
}

const assignedTotal = (d: AssignDraft) => sum(Object.values(d.allocations))
const isOn = (d: AssignDraft, txId: string) => Object.prototype.hasOwnProperty.call(d.allocations, txId)

function openOf(state: MoneyState, tx: Transaction): Rupiah {
  return Math.max(0, remainingOf(state, tx))
}

/** Charges the payment can be assigned to, for the selected people. */
export function candidates(ledger: Ledger, d: AssignDraft): Candidates {
  const state = computeMoney(ledger, d.paymentId)
  const mine = ledger.transactions.filter((t) => t.cardId === d.cardId && t.ownerId !== null && d.ownerIds.includes(t.ownerId) && effective(t) > 0)
  const free = mine.filter((t) => !isOn(d, t.id))
  const visible = mine.filter((t) => isOn(d, t.id) || (openOf(state, t) > 0 && t.date <= d.date))
  const groups = ledger.statements
    .filter((s) => s.cardId === d.cardId)
    .sort((a, b) => statementSortKey(a).localeCompare(statementSortKey(b)))
    .map((s) => {
      const items = visible
        .filter((t) => t.statementId === s.id)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({ txId: t.id, ownerId: t.ownerId, date: t.date, open: openOf(state, t), assigned: d.allocations[t.id] ?? 0 }))
      return { statementId: s.id, items, openTotal: sum(items.map((i) => i.open)) }
    })
    .filter((g) => g.items.length > 0)
  return {
    groups,
    hiddenLater: free.filter((t) => t.date > d.date && openOf(state, t) > 0).length,
    hiddenPaid: free.filter((t) => openOf(state, t) === 0).length,
  }
}

export type TapOutcome = 'unticked' | 'assigned' | 'partial' | 'paymentFull' | 'nothingOpen'

/**
 * Tap a charge: untick it if ticked; otherwise assign its open amount capped at what is left of the payment.
 * `paymentFull` = nothing left ("Untick something first"); `partial` = capped ("only X was left").
 */
export function tapCharge(ledger: Ledger, d: AssignDraft, txId: string): { draft: AssignDraft; outcome: TapOutcome; amount: Rupiah } {
  if (isOn(d, txId)) {
    const { [txId]: _gone, ...rest } = d.allocations
    return { draft: { ...d, allocations: rest }, outcome: 'unticked', amount: 0 }
  }
  const left = d.amount - assignedTotal(d)
  if (left <= 0) return { draft: d, outcome: 'paymentFull', amount: 0 }
  const open = openOf(computeMoney(ledger, d.paymentId), requireTx(ledger, txId))
  if (open === 0) return { draft: d, outcome: 'nothingOpen', amount: 0 }
  const amount = Math.min(open, left)
  return { draft: { ...d, allocations: { ...d.allocations, [txId]: amount } }, outcome: amount < open ? 'partial' : 'assigned', amount }
}

function requireTx(ledger: Ledger, txId: string): Transaction {
  const tx = ledger.transactions.find((t) => t.id === txId)
  if (!tx) throw new MoneyError(`unknown transaction ${txId}`)
  return tx
}

function fill(items: CandidateItem[], left: Rupiah, into: Record<string, Rupiah>): { filled: number; left: Rupiah } {
  let filled = 0
  for (const item of items) {
    const take = Math.min(item.open, left)
    if (take > 0) {
      into[item.txId] = take
      left -= take
      filled++
    }
  }
  return { filled, left }
}

/** "Fill oldest first": clears the ticks, then fills charges in group order until the payment runs out. */
export function fillOldestFirst(ledger: Ledger, d: AssignDraft): { draft: AssignDraft; filled: number; of: number } {
  const cleared = { ...d, allocations: {} }
  const items = candidates(ledger, cleared).groups.flatMap((g) => g.items)
  const allocations: Record<string, Rupiah> = {}
  const { filled } = fill(items, d.amount, allocations)
  return { draft: { ...d, allocations }, filled, of: items.length }
}

/** "Pay all in this statement": re-fills that group's charges, capped at what is left ("ran out after n of m"). */
export function payAllInStatement(ledger: Ledger, d: AssignDraft, statementId: string): { draft: AssignDraft; filled: number; of: number; ranOut: boolean } {
  const group = candidates(ledger, d).groups.find((g) => g.statementId === statementId)
  if (!group) return { draft: d, filled: 0, of: 0, ranOut: false }
  const allocations: Record<string, Rupiah> = {}
  for (const [k, v] of Object.entries(d.allocations)) if (!group.items.some((i) => i.txId === k)) allocations[k] = v
  const before = d.amount - sum(Object.values(allocations))
  const { filled, left } = fill(group.items, before, allocations)
  return { draft: { ...d, allocations }, filled, of: group.items.length, ranOut: before - left < group.openTotal }
}

/** "Pay full" after a partial: min(open, current + left). `full` is false when the payment can't cover it. */
export function payFull(ledger: Ledger, d: AssignDraft, txId: string): { draft: AssignDraft; full: boolean } {
  const open = openOf(computeMoney(ledger, d.paymentId), requireTx(ledger, txId))
  const current = d.allocations[txId] ?? 0
  const left = d.amount - assignedTotal(d)
  const amount = Math.min(open, current + Math.max(0, left))
  return { draft: { ...d, allocations: { ...d.allocations, [txId]: amount } }, full: amount === open }
}

/** Typed amount on a ticked charge. */
export function setAllocation(d: AssignDraft, txId: string, amount: Rupiah): AssignDraft {
  assertRupiah(amount, 'assigned amount')
  if (amount < 0) throw new MoneyError('assigned amount cannot be negative')
  return { ...d, allocations: { ...d.allocations, [txId]: amount } }
}

/** Single-person mode switches person and clears the ticks; multi-person mode toggles and drops that person's ticks. */
export function selectOwner(ledger: Ledger, d: AssignDraft, ownerId: string): AssignDraft {
  if (!d.multi) return d.ownerIds.length === 1 && d.ownerIds[0] === ownerId ? d : { ...d, ownerIds: [ownerId], allocations: {} }
  if (!d.ownerIds.includes(ownerId)) return { ...d, ownerIds: [...d.ownerIds, ownerId] }
  const allocations: Record<string, Rupiah> = {}
  for (const [k, v] of Object.entries(d.allocations)) if (ledger.transactions.find((t) => t.id === k)?.ownerId !== ownerId) allocations[k] = v
  return { ...d, ownerIds: d.ownerIds.filter((o) => o !== ownerId), allocations }
}

export interface DraftCheck {
  assigned: Rupiah
  /** Left to assign (negative when over-assigned). */
  left: Rupiah
  /** More assigned than the payment. */
  overPayment: boolean
  /** Charges given more than is open on them. */
  overCharges: string[]
  canSave: boolean
}

export function checkDraft(ledger: Ledger, d: AssignDraft): DraftCheck {
  assertRupiah(d.amount, 'payment amount')
  const state = computeMoney(ledger, d.paymentId)
  const assigned = assignedTotal(d)
  const left = d.amount - assigned
  const overCharges = Object.entries(d.allocations)
    .filter(([txId, v]) => v > openOf(state, requireTx(ledger, txId)))
    .map(([txId]) => txId)
  return { assigned, left, overPayment: left < 0, overCharges, canSave: d.amount > 0 && left >= 0 && overCharges.length === 0 }
}

/**
 * Save: writes the draft onto the payment. Zero amounts are dropped. A leftover goes to `depositOwnerId`
 * (the owner's deposit) or, with `null`, stays unassigned ("Decide later", bill stays Draft).
 * Bank payments keep their amount and date.
 */
export function savePayment(ledger: Ledger, base: Payment, d: AssignDraft, depositOwnerId: string | null): Payment {
  const draft = canEditAmountAndDate(base) ? d : { ...d, amount: base.amount, date: base.date }
  if (!checkDraft(ledger, draft).canSave) throw new MoneyError('cannot save: over-assigned or empty payment')
  const allocations: Allocation[] = Object.entries(draft.allocations)
    .filter(([, v]) => v > 0)
    .map(([txId, v]) => ({ txId, amount: v }))
  const leftover = draft.amount - sum(allocations.map((a) => a.amount))
  const { depositOwnerId: _old, ...rest } = base
  const next: Payment = { ...rest, amount: draft.amount, date: draft.date, allocations, forOwnerIds: [...draft.ownerIds] }
  if (leftover > 0 && depositOwnerId !== null) next.depositOwnerId = depositOwnerId
  return next
}
