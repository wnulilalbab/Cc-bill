// What the Payments screens show: the tabs, each payment's labels, the deposits per owner and what a delete would undo.
// Pure functions over the domain ledger (money from src/domain), so the screens only render.
import { computeMoney, countedPayments, depositLeftOf, depositPaidOf, depositUsedOf, effective, ownerDepositLeft, remainingOf, unassignedOf, type MoneyState } from '../../domain/amounts'
import { sum } from '../../domain/money'
import { allocStatus, bankStatus, deletePayment, paymentTab } from '../../domain/payments'
import { latestBilled } from '../../domain/statements'
import type { BilledStatement, Ledger, Payment, Rupiah, Transaction } from '../../domain/types'
import { parseAmount, rp } from '../settings/format'
import { dayLabel, fmt, statementName, statementsTurningDraft } from '../transactions/view'

export type ListTab = 'toAssign' | 'assigned' | 'notOnStatement' | 'duplicates'
export type PaymentsTab = ListTab | 'deposits'

export const TAB_LABEL: Record<PaymentsTab, string> = {
  toAssign: 'To assign',
  assigned: 'Assigned',
  notOnStatement: 'Not on a statement',
  duplicates: 'Possible duplicates',
  deposits: 'Deposits',
}

const newestFirst = (a: Payment, b: Payment) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)

/**
 * The lists of the Payments tab (domain paymentTab and bankStatus), newest first:
 * - To assign / Assigned: not fully assigned without a deposit / the rest;
 * - Not on a statement: hand-recorded payments the bank hasn't shown yet (missing first, then waiting), which may also
 *   be in To assign or Assigned;
 * - Possible duplicates: hand-recorded payments next to an already-assigned bank line of the same amount.
 * A bank line merged into a hand-recorded payment is shown through that payment only.
 */
export function paymentLists(ledger: Ledger, cardId: string): Record<ListTab, Payment[]> {
  const out: Record<ListTab, Payment[]> = { toAssign: [], assigned: [], notOnStatement: [], duplicates: [] }
  const missing: Payment[] = []
  for (const p of ledger.payments.filter((x) => x.cardId === cardId).sort(newestFirst)) {
    const tab = paymentTab(ledger, p)
    if (tab === null) continue
    const status = bankStatus(ledger, p).kind
    if (status === 'possibleDuplicate') out.duplicates.push(p)
    else if (status === 'missing') missing.push(p)
    else {
      out[tab === 'toAssign' ? 'toAssign' : 'assigned'].push(p)
      if (status === 'waiting' || status === 'pending') out.notOnStatement.push(p)
    }
  }
  out.notOnStatement = [...missing, ...out.notOnStatement]
  return out
}

const monthOf = (ledger: Pick<Ledger, 'statements'>, statementId: string) => statementName(ledger.statements.find((s) => s.id === statementId)).replace(' statement', '')

export interface Label {
  text: string
  /** Pill tone: '' (neutral), ok, warn, bad. */
  tone: '' | 'ok' | 'warn' | 'bad'
}

/** Where the bank shows the payment. */
export function bankLabel(ledger: Ledger, p: Payment): Label {
  const st = bankStatus(ledger, p)
  switch (st.kind) {
    case 'onStatement':
      return { text: `On ${monthOf(ledger, st.statementId)} statement`, tone: 'ok' }
    case 'unbilled':
      return { text: 'In Unbilled · moves to the next statement', tone: '' }
    case 'linked':
      return { text: `Matched to ${monthOf(ledger, st.statementId)} statement ✓`, tone: 'ok' }
    case 'missing':
      return { text: `Not on ${monthOf(ledger, st.statementId)} statement`, tone: 'bad' }
    case 'waiting':
      return { text: `Still waiting (not on ${monthOf(ledger, st.statementId)})`, tone: 'warn' }
    case 'possibleDuplicate': {
      const line = ledger.payments.find((x) => x.id === st.lineId)!
      return { text: `Same amount as the ${dayLabel(line.date)} bank line`, tone: 'bad' }
    }
    default:
      return { text: 'Waiting for the next statement', tone: 'warn' }
  }
}

/** How much of the payment is assigned (domain allocStatus). */
export function allocLabel(state: MoneyState, p: Payment, nameOf: (id: string) => string): Label {
  const st = allocStatus(state, p)
  if (st.kind === 'full') return { text: 'Fully assigned ✓', tone: 'ok' }
  if (st.kind === 'deposit') return { text: `Deposit for ${nameOf(st.ownerId)}: ${fmt(st.used)} used, ${fmt(st.left)} left`, tone: '' }
  if (st.kind === 'none') return { text: 'Not assigned yet', tone: 'warn' }
  return { text: `${rp(st.left)} not assigned`, tone: 'warn' }
}

/** "Oct 2026 statement · PEMBAYARAN …", "Unbilled · …" or "Recorded by you". */
export function sourceLine(ledger: Ledger, p: Payment): string {
  if (p.source === 'manual') return p.description ? `Recorded by you · ${p.description}` : 'Recorded by you'
  const where = statementName(ledger.statements.find((s) => s.id === p.statementId))
  return p.description ? `${where} · ${p.description}` : where
}

/** Owners the payment pays: those of the charges it is assigned to, then its deposit owner. */
export function paymentOwners(ledger: Pick<Ledger, 'transactions'>, p: Payment): string[] {
  const out: string[] = []
  for (const a of p.allocations) {
    const o = ledger.transactions.find((t) => t.id === a.txId)?.ownerId
    if (o && !out.includes(o)) out.push(o)
  }
  if (p.depositOwnerId !== undefined && !out.includes(p.depositOwnerId)) out.push(p.depositOwnerId)
  return out
}

/** An Unbilled payment line dated before the latest statement that the statement did not contain (and not kept waiting). */
export function unbilledNotOnStatement(ledger: Ledger, p: Payment): BilledStatement | undefined {
  const latest = latestBilled(ledger, p.cardId)
  return p.source === 'unbilled' && !p.waiting && latest && p.date < latest.statementDate ? latest : undefined
}

export interface DeleteEffect {
  /** Charges that become (more) unpaid, with what is left on them before and after. */
  unpaid: { tx: Transaction; before: Rupiah; after: Rupiah }[]
  /** Statements (by name) that go back to Draft. */
  drafts: string[]
  /** The bank line the payment was matched to: it counts again, to assign. */
  bankLine?: Payment
}

/** What deleting a payment would undo (domain deletePayment, before and after). */
export function deleteEffect(ledger: Ledger, paymentId: string): DeleteEffect {
  const after: Ledger = { ...ledger, payments: deletePayment(ledger.payments, paymentId) }
  const s0 = computeMoney(ledger)
  const s1 = computeMoney(after)
  const unpaid = ledger.transactions
    .filter((t) => effective(t) > 0)
    .map((tx) => ({ tx, before: remainingOf(s0, tx), after: remainingOf(s1, tx) }))
    .filter((x) => x.after > x.before)
    .sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.tx.id.localeCompare(b.tx.id))
  const p = ledger.payments.find((x) => x.id === paymentId)
  const bankLine = p?.linkedStatementLine ? ledger.payments.find((x) => x.id === p.linkedStatementLine) : undefined
  return { unpaid, drafts: statementsTurningDraft(ledger, after), ...(bankLine && { bankLine }) }
}

export interface OwnerDeposit {
  ownerId: string
  /** "Deposit waiting": unused, across the owner's deposits. */
  left: Rupiah
  payments: { payment: Payment; kept: Rupiah; used: Rupiah; left: Rupiah }[]
  /** Charges paid from the deposit, oldest first. */
  charges: { tx: Transaction; amount: Rupiah }[]
}

/** Deposits per owner of a card (owners with at least one deposit), in the given owner order. */
export function ownerDeposits(ledger: Ledger, cardId: string, ownerIds: readonly string[], state: MoneyState = computeMoney(ledger)): OwnerDeposit[] {
  const deposits = countedPayments(ledger.payments)
    .filter((p) => p.cardId === cardId && p.depositOwnerId !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date))
  return ownerIds
    .map((ownerId) => {
      const payments = deposits
        .filter((p) => p.depositOwnerId === ownerId)
        .map((payment) => ({ payment, kept: Math.max(0, unassignedOf(payment)), used: depositUsedOf(state, payment), left: depositLeftOf(state, payment) }))
      const charges = ledger.transactions
        .filter((t) => t.cardId === cardId && t.ownerId === ownerId && depositPaidOf(state, t.id) > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .map((tx) => ({ tx, amount: depositPaidOf(state, tx.id) }))
      return { ownerId, left: ownerDepositLeft(state, ownerId), payments, charges }
    })
    .filter((d) => d.payments.length > 0)
}

/** Sum of what the given payments still have to assign (for the tab badge). */
export const toAssignTotal = (payments: readonly Payment[]) => sum(payments.map((p) => Math.max(0, unassignedOf(p))))

/** Typed amount for the live display (shared parseAmount): anything that is not a whole rupiah amount above 0 counts as 0. */
export const typedRupiah = (text: string): number => parseAmount(text) ?? 0
