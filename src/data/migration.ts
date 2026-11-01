// Old database → Phase-1 database, as plan (pure) → preview (plan.adjustments) → apply → verify.
// The old database is only ever read here; deleteOldData() is the one place that removes it.
import Dexie from 'dexie'
import { feeOwner } from '../domain/bill'
import { parseInstallment } from '../domain/installments'
import { monthIndex, sum } from '../domain/money'
import { reconcile, type StatementRow } from '../domain/reconcile'
import type { Allocation, BilledStatement, Card, InstallmentPlan, Owner, Payment, PrintedTotals, Statement, Transaction, TxKind } from '../domain/types'
import { DATA_TABLES, emptyData, type DataTable, type NewData, type NewDb } from './db'
import { oldDbName } from './env'
import { fingerprint, MigrationError, oldBackupJson, readOldData, type OldData, type OldExpense, type OldPeriod, type OldTransaction } from './old'
import { readAll } from './repo'

export const MIGRATED_CARD = { id: 'card-bca-shared', name: 'BCA Shared', bank: 'BCA' } as const
export const MIGRATED_UNBILLED_ID = `${MIGRATED_CARD.id}-unbilled`
const UNKNOWN_OWNER = 'unknown'
const DEFAULT_DUE_DAYS = 15

export type AdjustmentKind =
  | 'card'
  | 'unbilledMerged'
  | 'unknownOwner'
  | 'unknownOwnerRemoved'
  | 'missingOwner'
  | 'untagged'
  | 'feeOwner'
  | 'signFixed'
  | 'emptyDescription'
  | 'hidden'
  | 'installmentNumber'
  | 'statementPayments'
  | 'manualPayments'
  | 'leftToAssign'
  | 'overAssigned'
  | 'mergedAssignments'
  | 'droppedAssignments'
  | 'droppedTags'
  | 'statementDate'
  | 'dueDate'
  | 'printedTotals'
  | 'notKept'

/** One line of the preview: what changes, and which old records it touches. */
export interface Adjustment {
  kind: AdjustmentKind
  message: string
  /** Old record ids concerned (may be empty for a general note). */
  ids: string[]
}

export interface MigrationOptions {
  /** Old owner id that becomes the card's default owner. `null` (default) = "None". */
  defaultOwnerId?: string | null
  /** Statement day of the card, used for the statement dates. Unset = the last row date of each statement. */
  statementDay?: number
}

export interface MigrationPlan {
  data: NewData
  adjustments: Adjustment[]
  /** Fingerprint of the old data this plan was made from. */
  oldFingerprint: string
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pad2 = (n: number) => String(n).padStart(2, '0')

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const isUnbilled = (p: OldPeriod) => p.type === 'unbilled' || p.id === 'unbilled-pool'
const isUnknown = (name: string) => name.trim().toLowerCase() === UNKNOWN_OWNER

interface ResolvedAllocation {
  paymentId: string
  txId: string
  amount: number
}

/**
 * Which old assignments carry over. An assignment carries over when its payment is a bank payment line or a
 * hand-recorded payment and its tag belongs to an existing, non-payment row. Old assignments made from a refund
 * are not carried over: in the new model a refund reduces its owner's charges by itself.
 */
export function resolveAllocations(old: OldData): { kept: ResolvedAllocation[]; dropped: { id: string; reason: string }[] } {
  const txById = new Map(old.transactions.map((t) => [t.id, t]))
  const expenseById = new Map(old.expenses.map((e) => [e.id, e]))
  const manual = new Set(old.payments.map((p) => p.id))
  const kept: ResolvedAllocation[] = []
  const dropped: { id: string; reason: string }[] = []
  for (const a of old.paymentAllocations) {
    const payTx = txById.get(a.paymentId)
    const expense = expenseById.get(a.expenseId)
    const tx = expense && txById.get(expense.transactionId)
    if (payTx && payTx.type !== 'payment') dropped.push({ id: a.id, reason: 'made from a refund or reversal, which now reduces the charges by itself' })
    else if (!payTx && !manual.has(a.paymentId)) dropped.push({ id: a.id, reason: `its payment (${a.paymentId}) no longer exists` })
    else if (!tx || tx.type === 'payment') dropped.push({ id: a.id, reason: `its tagged row (${a.expenseId}) no longer exists` })
    else kept.push({ paymentId: a.paymentId, txId: tx.id, amount: a.amount })
  }
  return { kept, dropped }
}

/** Sum of carried-over assignments per payment and row (several old assignments to the same pair are combined). */
function pairTotals(kept: readonly ResolvedAllocation[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const a of kept) {
    const m = out.get(a.paymentId) ?? new Map<string, number>()
    m.set(a.txId, (m.get(a.txId) ?? 0) + a.amount)
    out.set(a.paymentId, m)
  }
  return out
}

/** Builds the new records and the list of every adjustment. Pure: reads nothing, writes nothing. */
export function planMigration(old: OldData, options: MigrationOptions = {}): MigrationPlan {
  const adjustments: Adjustment[] = []
  const note = (kind: AdjustmentKind, message: string, ids: string[] = []) => adjustments.push({ kind, message, ids })

  const ownerById = new Map(old.owners.map((o) => [o.id, o]))
  const unknownIds = new Set(old.owners.filter((o) => isUnknown(o.name)).map((o) => o.id))
  const defaultOwnerId = options.defaultOwnerId ?? null
  if (defaultOwnerId !== null && (!ownerById.has(defaultOwnerId) || unknownIds.has(defaultOwnerId))) {
    throw new MigrationError(`The default owner must be one of the old owners (other than "Unknown"), got "${defaultOwnerId}".`)
  }
  const defaultName = defaultOwnerId === null ? 'None' : ownerById.get(defaultOwnerId)!.name
  const day = options.statementDay
  if (day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 31)) throw new MigrationError(`The statement day must be 1–31, got ${day}.`)

  const card: Card = { id: MIGRATED_CARD.id, name: MIGRATED_CARD.name, bank: MIGRATED_CARD.bank, defaultOwnerId, ...(day !== undefined && { statementDay: day }) }
  const cardId = card.id

  // Owners: every old owner except "Unknown".
  const owners: Owner[] = old.owners.filter((o) => !unknownIds.has(o.id)).map((o) => ({ id: o.id, cardId, name: o.name }))
  if (unknownIds.size) note('unknownOwnerRemoved', `The owner "Unknown" is not carried over; its rows go to the card default (${defaultName}).`, [...unknownIds])

  // Statements.
  const billedPeriods = old.periods.filter((p) => !isUnbilled(p)).sort((a, b) => a.year - b.year || a.month - b.month)
  const unbilledPeriods = old.periods.filter(isUnbilled)
  const statementOf = new Map<string, string>(unbilledPeriods.map((p) => [p.id, MIGRATED_UNBILLED_ID]))
  for (const p of billedPeriods) {
    if (p.month < 1 || p.month > 12) throw new MigrationError(`Statement ${p.id} has month ${p.month}; it must be 1–12.`)
    statementOf.set(p.id, p.id)
  }
  note('card', `All ${plural(billedPeriods.length, 'statement')} and their rows and payments go to card "${card.name}".`, billedPeriods.map((p) => p.id))
  if (unbilledPeriods.length !== 1) {
    note('unbilledMerged', `${plural(unbilledPeriods.length, 'Unbilled list')} in the old data; the card gets one Unbilled list.`, unbilledPeriods.map((p) => p.id))
  }

  // Tags (expenses): one per row. Extra or orphan tags are not carried over.
  const txById = new Map(old.transactions.map((t) => [t.id, t]))
  const tagOf = new Map<string, OldExpense>()
  const extraTags: string[] = []
  for (const e of old.expenses) {
    const t = txById.get(e.transactionId)
    if (!t || t.type === 'payment' || tagOf.has(t.id)) extraTags.push(e.id)
    else tagOf.set(t.id, e)
  }
  if (extraTags.length) note('droppedTags', `${plural(extraTags.length, 'tag')} not carried over: the row is missing, is a payment, or already has a tag.`, extraTags)

  // Transactions.
  const planIds = new Set(old.installmentPlans.map((p) => p.id))
  const planById = new Map(old.installmentPlans.map((p) => [p.id, p]))
  const periodById = new Map(old.periods.map((p) => [p.id, p]))
  const unknownRows: string[] = []
  const missingOwnerRows: string[] = []
  const untaggedRows: string[] = []
  const feeRows: string[] = []
  const signRows: string[] = []
  const hiddenRows: string[] = []
  const numberRows: string[] = []
  const transactions: Transaction[] = []
  const reversed = new Set<string>()
  for (const t of old.transactions) {
    if (t.type === 'payment') continue
    const tag = tagOf.get(t.id)
    let kind = t.type as TxKind
    let check = false
    const isCredit = kind === 'refund' || kind === 'reversal'
    if (t.amount < 0 && !isCredit) {
      kind = 'refund'
      check = true
      signRows.push(t.id)
    } else if (t.amount > 0 && isCredit) {
      kind = 'purchase'
      check = true
      signRows.push(t.id)
    }
    let ownerId: string | null
    if (!tag) {
      if (kind === 'fee' || kind === 'interest') {
        const f = feeOwner(card)
        ownerId = f.ownerId
        check ||= f.check
        feeRows.push(t.id)
      } else {
        ownerId = defaultOwnerId
        check = true
        untaggedRows.push(t.id)
      }
    } else if (unknownIds.has(tag.ownerId)) {
      ownerId = defaultOwnerId
      check = true
      unknownRows.push(t.id)
    } else if (!ownerById.has(tag.ownerId)) {
      ownerId = defaultOwnerId
      check = true
      missingOwnerRows.push(t.id)
    } else {
      ownerId = tag.ownerId
    }
    const planId = tag?.installmentPlanId !== undefined && planIds.has(tag.installmentPlanId) ? tag.installmentPlanId : undefined
    let installment: { n: number; of: number } | undefined
    if (kind === 'installment') {
      installment = parseInstallment(t.description) ?? undefined
      const plan = planId ? planById.get(planId) : undefined
      const period = periodById.get(t.periodId)!
      if (!installment && plan && !isUnbilled(period)) {
        const n = period.year * 12 + period.month - monthIndex(plan.startPeriod) + 1
        if (n >= 1 && n <= plan.totalMonths) {
          installment = { n, of: plan.totalMonths }
          numberRows.push(t.id)
        }
      }
    }
    const row: Transaction = {
      id: t.id,
      cardId,
      statementId: statementOf.get(t.periodId)!,
      date: t.date,
      description: t.description,
      amount: t.amount,
      kind,
      ownerId,
      ...(check && { check }),
      ...(planId && { planId }),
      ...(installment && { installment }),
    }
    if (t.hidden) {
      hiddenRows.push(t.id)
      if (kind === 'reversal') {
        const original = old.transactions.find(
          (o) => o.hidden && o.periodId === t.periodId && o.type !== 'reversal' && o.type !== 'payment' && o.amount === -t.amount && !reversed.has(o.id),
        )
        if (original) {
          reversed.add(original.id)
          row.reverses = original.id
        }
      } else {
        row.cancelled = true
      }
    }
    transactions.push(row)
  }
  if (unknownRows.length) note('unknownOwner', `${plural(unknownRows.length, 'row')} tagged "Unknown" go to the card default (${defaultName}) and are marked Check.`, unknownRows)
  if (missingOwnerRows.length) note('missingOwner', `${plural(missingOwnerRows.length, 'row')} tagged with an owner that no longer exists go to the card default (${defaultName}) and are marked Check.`, missingOwnerRows)
  if (untaggedRows.length) note('untagged', `${plural(untaggedRows.length, 'row')} without an owner go to the card default (${defaultName}) and are marked Check.`, untaggedRows)
  if (feeRows.length) note('feeOwner', `${plural(feeRows.length, 'fee or interest row')} without an owner go to the card default (${defaultName})${defaultOwnerId === null ? ' and are marked Check' : ''}.`, feeRows)
  if (signRows.length) note('signFixed', `${plural(signRows.length, 'row')} had a type that did not match the sign of the amount; the type now follows the amount and the row is marked Check.`, signRows)
  const blank = old.transactions.filter((t) => t.description.trim() === '').map((t) => t.id)
  if (blank.length) note('emptyDescription', `${plural(blank.length, 'row')} with an empty description are kept as they are.`, blank)
  if (hiddenRows.length) note('hidden', `${plural(hiddenRows.length, 'hidden row')} (reversal pairs) are kept as cancelled rows and reversals, which count 0.`, hiddenRows)
  if (numberRows.length) note('installmentNumber', `${plural(numberRows.length, 'installment row')} got their number (n of N) from the plan's start month.`, numberRows)

  // Payments, with their assignments.
  const { kept, dropped } = resolveAllocations(old)
  const pairs = pairTotals(kept)
  const keptCountByPayment = new Map<string, number>()
  for (const a of kept) keptCountByPayment.set(a.paymentId, (keptCountByPayment.get(a.paymentId) ?? 0) + 1)
  const allocationsOf = (paymentId: string): Allocation[] => [...(pairs.get(paymentId) ?? new Map<string, number>())].map(([txId, amount]) => ({ txId, amount }))
  const bank = old.transactions.filter((t): t is OldTransaction => t.type === 'payment')
  const payments: Payment[] = [
    ...bank.map((t): Payment => {
      const statementId = statementOf.get(t.periodId)!
      return {
        id: t.id,
        cardId,
        source: statementId === MIGRATED_UNBILLED_ID ? 'unbilled' : 'statement',
        date: t.date,
        amount: -t.amount,
        statementId,
        allocations: allocationsOf(t.id),
        description: t.description,
      }
    }),
    ...old.payments.map((p): Payment => ({
      id: p.id,
      cardId,
      source: 'manual',
      date: p.date,
      amount: p.amount,
      allocations: allocationsOf(p.id),
      ...(p.note && { description: p.note }),
    })),
  ]
  const assignedOf = (p: Payment) => sum(p.allocations.map((a) => a.amount))
  if (bank.length) {
    const n = sum(bank.map((t) => keptCountByPayment.get(t.id) ?? 0))
    note('statementPayments', `${plural(bank.length, 'bank payment line')} become payments and keep their ${plural(n, 'assignment')}.`, bank.map((t) => t.id))
  }
  if (old.payments.length) {
    const n = sum(old.payments.map((p) => keptCountByPayment.get(p.id) ?? 0))
    note('manualPayments', `${plural(old.payments.length, 'hand-recorded payment')} are kept with their ${plural(n, 'assignment')}.`, old.payments.map((p) => p.id))
  }
  const left = payments.filter((p) => assignedOf(p) < p.amount)
  if (left.length) {
    note('leftToAssign', `${plural(left.length, 'payment')} have money left to assign (${rp(sum(left.map((p) => p.amount - assignedOf(p))))} in all); it stays "Decide later".`, left.map((p) => p.id))
  }
  const over = payments.filter((p) => assignedOf(p) > p.amount)
  if (over.length) note('overAssigned', `${plural(over.length, 'payment')} were assigned more than their amount; reopen them to fix the assignments.`, over.map((p) => p.id))
  const merged = kept.length - sum(payments.map((p) => p.allocations.length))
  if (merged) note('mergedAssignments', `${plural(merged, 'assignment')} to a row that the same payment already covered are combined with it.`)
  if (dropped.length) {
    note('droppedAssignments', `${plural(dropped.length, 'assignment')} not carried over: ${[...new Set(dropped.map((d) => d.reason))].join('; ')}.`, dropped.map((d) => d.id))
  }

  // Statement dates, due dates and printed totals (the old app stored none of these).
  const statements: Statement[] = []
  const derivedDates: string[] = []
  const derivedDue: string[] = []
  let prevBalance = 0
  for (const p of billedPeriods) {
    const rows = transactions.filter((t) => t.statementId === p.id)
    const lines = payments.filter((x) => x.source === 'statement' && x.statementId === p.id)
    let statementDate: string
    if (day !== undefined) {
      const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
      statementDate = `${p.year}-${pad2(p.month)}-${pad2(Math.min(day, last))}`
    } else {
      const dates = [...rows.map((t) => t.date), ...lines.map((x) => x.date)].sort()
      statementDate = dates.at(-1) ?? `${p.year}-${pad2(p.month)}-01`
      derivedDates.push(p.id)
    }
    const dueDate = p.dueDate ?? addDays(statementDate, DEFAULT_DUE_DAYS)
    if (!p.dueDate) derivedDue.push(p.id)
    const printedRows: StatementRow[] = [...rows.map((t) => ({ amount: t.amount, kind: t.kind })), ...lines.map((x) => ({ amount: -x.amount, kind: 'payment' as const }))]
    const computed = reconcile({ prevBalance, credits: 0, purchases: 0, feesInterest: 0, newBalance: 0 }, printedRows).computed
    const printed: PrintedTotals = { prevBalance, ...computed }
    prevBalance = computed.newBalance
    statements.push({ id: p.id, cardId, kind: 'billed', statementDate, dueDate, printed } satisfies BilledStatement)
  }
  statements.push({ id: MIGRATED_UNBILLED_ID, cardId, kind: 'unbilled' })
  if (derivedDates.length) note('statementDate', `${plural(derivedDates.length, 'statement')} get the date of their last row as statement date.`, derivedDates)
  if (derivedDue.length) note('dueDate', `${plural(derivedDue.length, 'statement')} had no due date; it is set to ${DEFAULT_DUE_DAYS} days after the statement date.`, derivedDue)
  if (billedPeriods.length) note('printedTotals', 'The old app did not store the printed statement totals; they are computed from the rows, so every statement reconciles.', billedPeriods.map((p) => p.id))

  // Installment plans.
  const plans: InstallmentPlan[] = old.installmentPlans.map((p) => {
    const ownerId = ownerById.has(p.ownerId) && !unknownIds.has(p.ownerId) ? p.ownerId : defaultOwnerId
    return { id: p.id, cardId, ownerId, name: p.name, monthly: p.monthlyAmount, total: p.totalMonths, start: p.startPeriod }
  })
  const planOwnerFixed = old.installmentPlans.filter((p, i) => plans[i].ownerId !== p.ownerId).map((p) => p.id)
  if (planOwnerFixed.length) note('missingOwner', `${plural(planOwnerFixed.length, 'installment plan')} with an "Unknown" or missing owner go to the card default (${defaultName}).`, planOwnerFixed)

  // What the new model does not store.
  const notKept = [
    old.owners.length && 'owner colours (colours now come from the card palette)',
    old.expenses.length && 'tag labels and paid status (status is recomputed from the payments)',
    old.installmentPlans.length && "installment plans' original price and notes",
  ].filter(Boolean)
  if (notKept.length) note('notKept', `Not stored in the new app: ${notKept.join('; ')}. They stay in the old data and its JSON backup.`)

  return {
    data: { ...emptyData(), cards: [card], owners, statements, transactions, payments, plans },
    adjustments,
    oldFingerprint: fingerprint(old),
  }
}

// ---- apply ----

interface MigrationRecord {
  ranAt: string
  oldFingerprint: string
  ids: Record<DataTable, string[]>
}

export interface VerificationRecord {
  ok: boolean
  at: string
  oldFingerprint: string
  differences: Difference[]
}

const META_MIGRATION = 'migration'
const META_VERIFICATION = 'verification'

/**
 * Writes the plan to the new database in one transaction. Records of an earlier migration run are removed first,
 * so running it again replaces them cleanly. Never touches the old database.
 */
export async function applyMigration(db: NewDb, plan: MigrationPlan, now: string = new Date().toISOString()): Promise<void> {
  await db.transaction('rw', [...db.dataTables(), db.meta], async () => {
    const previous = (await db.meta.get(META_MIGRATION))?.value as MigrationRecord | undefined
    if (previous) for (const t of DATA_TABLES) await db.table(t).bulkDelete(previous.ids[t])
    for (const t of DATA_TABLES) await db.table(t).bulkPut(plan.data[t])
    const ids = Object.fromEntries(DATA_TABLES.map((t) => [t, plan.data[t].map((r) => r.id)])) as Record<DataTable, string[]>
    await db.meta.put({ key: META_MIGRATION, value: { ranAt: now, oldFingerprint: plan.oldFingerprint, ids } satisfies MigrationRecord })
    await db.meta.delete(META_VERIFICATION)
  })
}

// ---- verify ----

export interface Difference {
  /** What was compared, e.g. `count of transactions` or `amount of transaction tx-0001`. */
  check: string
  expected: number | string
  actual: number | string
}

export interface MigrationTotals {
  /** Sum of positive row amounts. */
  charges: number
  /** Refunds, reversals and bank payment lines. */
  credits: number
  /** Hand-recorded payments. */
  manualPayments: number
  /** Sum of carried-over assignments. */
  allocated: number
}

export interface MigrationCounts {
  owners: number
  statements: number
  transactions: number
  bankPayments: number
  manualPayments: number
  plans: number
  allocations: number
}

export interface Verification {
  ok: boolean
  differences: Difference[]
  expected: { counts: MigrationCounts; totals: MigrationTotals }
  actual: { counts: MigrationCounts; totals: MigrationTotals }
}

/** What the migrated data must add up to, from the old data alone. */
export function expectedFromOld(old: OldData): { counts: MigrationCounts; totals: MigrationTotals; amounts: Map<string, number>; pairs: Map<string, number> } {
  const { kept } = resolveAllocations(old)
  const pairs = new Map<string, number>()
  for (const a of kept) pairs.set(`${a.paymentId} → ${a.txId}`, (pairs.get(`${a.paymentId} → ${a.txId}`) ?? 0) + a.amount)
  const amounts = new Map<string, number>([
    ...old.transactions.map((t): [string, number] => [t.id, t.type === 'payment' ? -t.amount : t.amount]),
    ...old.payments.map((p): [string, number] => [p.id, p.amount]),
  ])
  const rows = old.transactions.filter((t) => t.type !== 'payment')
  return {
    counts: {
      owners: old.owners.filter((o) => !isUnknown(o.name)).length,
      statements: old.periods.filter((p) => !isUnbilled(p)).length + 1,
      transactions: rows.length,
      bankPayments: old.transactions.length - rows.length,
      manualPayments: old.payments.length,
      plans: old.installmentPlans.length,
      allocations: pairs.size,
    },
    totals: {
      charges: sum(old.transactions.filter((t) => t.amount > 0).map((t) => t.amount)),
      credits: sum(old.transactions.filter((t) => t.amount < 0).map((t) => -t.amount)),
      manualPayments: sum(old.payments.map((p) => p.amount)),
      allocated: sum(kept.map((a) => a.amount)),
    },
    amounts,
    pairs,
  }
}

/** Only the migrated card's records (other cards the user added later are not compared). */
function migratedPart(data: NewData): NewData {
  const mine = <T extends { cardId: string }>(rows: T[]) => rows.filter((r) => r.cardId === MIGRATED_CARD.id)
  return {
    cards: data.cards.filter((c) => c.id === MIGRATED_CARD.id),
    owners: mine(data.owners),
    statements: mine(data.statements),
    transactions: mine(data.transactions),
    payments: mine(data.payments),
    plans: mine(data.plans),
  }
}

/** Counts, totals and every row amount and assignment must match exactly; returns each difference. */
export function verifyMigration(old: OldData, newData: NewData): Verification {
  const want = expectedFromOld(old)
  const got = migratedPart(newData)
  const bank = got.payments.filter((p) => p.source !== 'manual')
  const manual = got.payments.filter((p) => p.source === 'manual')
  const allocations = got.payments.flatMap((p) => p.allocations.map((a) => ({ key: `${p.id} → ${a.txId}`, amount: a.amount })))
  const actual = {
    counts: {
      owners: got.owners.length,
      statements: got.statements.length,
      transactions: got.transactions.length,
      bankPayments: bank.length,
      manualPayments: manual.length,
      plans: got.plans.length,
      allocations: allocations.length,
    },
    totals: {
      charges: sum(got.transactions.filter((t) => t.amount > 0).map((t) => t.amount)),
      credits: sum(got.transactions.filter((t) => t.amount < 0).map((t) => -t.amount)) + sum(bank.map((p) => p.amount)),
      manualPayments: sum(manual.map((p) => p.amount)),
      allocated: sum(allocations.map((a) => a.amount)),
    },
  }
  const differences: Difference[] = []
  if (got.cards.length !== 1) differences.push({ check: `card "${MIGRATED_CARD.name}"`, expected: 'present', actual: 'missing' })
  for (const k of Object.keys(want.counts) as (keyof MigrationCounts)[]) {
    if (want.counts[k] !== actual.counts[k]) differences.push({ check: `count of ${k}`, expected: want.counts[k], actual: actual.counts[k] })
  }
  for (const k of Object.keys(want.totals) as (keyof MigrationTotals)[]) {
    if (want.totals[k] !== actual.totals[k]) differences.push({ check: `total of ${k}`, expected: want.totals[k], actual: actual.totals[k] })
  }
  const newAmounts = new Map<string, number>([...got.transactions, ...got.payments].map((r) => [r.id, r.amount]))
  compareMaps('amount of', want.amounts, newAmounts, differences)
  const newPairs = new Map<string, number>()
  for (const a of allocations) newPairs.set(a.key, (newPairs.get(a.key) ?? 0) + a.amount)
  compareMaps('assignment', want.pairs, newPairs, differences)
  return { ok: differences.length === 0, differences, expected: { counts: want.counts, totals: want.totals }, actual }
}

function compareMaps(label: string, want: Map<string, number>, got: Map<string, number>, out: Difference[]): void {
  for (const [id, amount] of want) {
    const a = got.get(id)
    if (a === undefined) out.push({ check: `${label} ${id}`, expected: amount, actual: 'missing' })
    else if (a !== amount) out.push({ check: `${label} ${id}`, expected: amount, actual: a })
  }
  for (const [id, amount] of got) if (!want.has(id)) out.push({ check: `${label} ${id}`, expected: 'absent', actual: amount })
}

/** Apply, then verify what is actually in the new database, and record the result. */
export async function migrate(db: NewDb, old: OldData, plan: MigrationPlan, now: string = new Date().toISOString()): Promise<Verification> {
  await applyMigration(db, plan, now)
  const verification = verifyMigration(old, await readAll(db))
  const record: VerificationRecord = { ok: verification.ok, at: now, oldFingerprint: plan.oldFingerprint, differences: verification.differences }
  await db.meta.put({ key: META_VERIFICATION, value: record })
  return verification
}

export async function lastVerification(db: NewDb): Promise<VerificationRecord | undefined> {
  return (await db.meta.get(META_VERIFICATION))?.value as VerificationRecord | undefined
}

// ---- delete old data ----

export interface OldBackup {
  json: string
  fileName: string
}

/**
 * Produces the JSON backup of the old database and hands it to `beforeDelete` (the UI downloads it there). Only when
 * that resolves is the old database deleted. Refuses unless the last migration verified, every record it wrote is
 * still in the new database, and the old data is still exactly what was verified.
 */
export async function deleteOldData(
  db: NewDb,
  { oldName = oldDbName(), now = new Date().toISOString(), beforeDelete }: { oldName?: string; now?: string; beforeDelete: (backup: OldBackup) => unknown },
): Promise<OldBackup> {
  if (typeof beforeDelete !== 'function') throw new MigrationError('The backup must be saved before the old data is deleted (beforeDelete is required).')
  const verification = await lastVerification(db)
  if (!verification?.ok) throw new MigrationError('Old data can only be deleted after a migration has passed verification.')
  const run = (await db.meta.get(META_MIGRATION))?.value as MigrationRecord | undefined
  if (!run) throw new MigrationError('There is no record of a migration in the new app. Run the migration first.')
  let missing = 0
  for (const t of DATA_TABLES) missing += (await db.table(t).bulkGet(run.ids[t])).filter((r) => r === undefined).length
  if (missing) {
    throw new MigrationError(`The migrated data is no longer complete in the new app (${plural(missing, 'record')} missing). Run the migration again before deleting the old data.`)
  }
  const old = await readOldData(oldName)
  if (!old) throw new MigrationError('There is no old data to delete.')
  if (fingerprint(old) !== verification.oldFingerprint) throw new MigrationError('The old data changed after it was verified. Run the migration again before deleting it.')
  const backup: OldBackup = { json: oldBackupJson(old, now), fileName: `ccbill-old-backup-${now.slice(0, 10)}.json` }
  await beforeDelete(backup)
  await Dexie.delete(oldName)
  return backup
}
