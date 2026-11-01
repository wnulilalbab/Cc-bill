// What saving an import changes, worked out without touching the database (src/import/commit.ts writes it).
// Statement imports: rows that match Unbilled rows move into the statement (owners, labels and payment assignments
// kept); a re-imported month replaces the old rows but matching rows keep theirs; installment plans are linked and
// installment conversions applied; hand-recorded payments are matched to the bank's payment lines (±5 days).
import { draftIssues } from '../domain/draft'
import { convertToInstallment, parseInstallment } from '../domain/installments'
import { applyLinks, matchManualPayments, type PaymentLink } from '../domain/matching'
import { daysBetween, monthIndex } from '../domain/money'
import { deleteTransaction } from '../domain/payments'
import { billedOf } from '../domain/statements'
import type { BilledStatement, Card, InstallmentPlan, Ledger, Payment, Statement, Transaction, TxKind } from '../domain/types'
import { checkTotals, ImportError, printedOf, problems, skippedKeys, type ImportDraft } from './draft'
import { sameText, type DraftRow } from './normalize'

export interface RowSummary {
  date: string
  description: string
  amount: number
}

export interface ImportReport {
  statementId: string
  target: ImportDraft['target']
  /** Totals check difference at save time (0 = matched; statements only). */
  difference: number | null
  added: RowSummary[]
  /** Unbilled rows and payment lines that moved into the statement. */
  moved: RowSummary[]
  movedPayments: RowSummary[]
  /** Re-import: rows that matched the old statement and kept their owners and payments. */
  kept: number
  /** Re-import: old rows that are not on the new file (removed; their payments go back to To assign). */
  removed: RowSummary[]
  /** New bank payment lines (to assign). */
  newPayments: RowSummary[]
  /** Unbilled rows / payment lines dated before this statement that it does not contain. */
  notOnStatement: RowSummary[]
  /** Ids of the Unbilled rows in `notOnStatement` (for Delete / Keep waiting). */
  notOnStatementRowIds: string[]
  /** Hand-recorded payments that are not on any statement yet. */
  missingPayments: RowSummary[]
  links: PaymentLink[]
  conversions: { description: string; ok: boolean; error?: string }[]
  skippedDuplicates: number
  overlapMerged: number
  backfill: boolean
}

export interface ImportPlan {
  statements: Statement[]
  transactions: Transaction[]
  payments: Payment[]
  plans: InstallmentPlan[]
  deleteTransactions: string[]
  deletePayments: string[]
  report: ImportReport
}

export interface PlanInput {
  ledger: Ledger
  card: Card
  draft: ImportDraft
  newId: (prefix: string) => string
}

const summary = (x: { date: string; description?: string; amount: number }): RowSummary => ({ date: x.date, description: x.description ?? 'Payment', amount: x.amount })
const near = (a: string, b: string, days: number) => Math.abs(daysBetween(a, b)) <= days
const pad = (n: number) => String(n).padStart(2, '0')
const monthOf = (index: number) => `${Math.floor((index - 1) / 12)}-${pad(((index - 1) % 12) + 1)}`
/** Rows printed on a statement and the same row in Unbilled may differ by a booking day. */
const MOVE_WINDOW_DAYS = 2

/** "CICILAN BCA KE 01 DARI 06, BLIBLI.COM" → "BLIBLI.COM"; "UNIQLO AEON BSD 002/003" → "UNIQLO AEON BSD". */
export function planName(description: string): string {
  const name = description
    .replace(/CICILAN\s+(BCA\s+)?KE\s+\d+\s+DARI\s+\d+\s*,?/i, '')
    .replace(/\b\d{3}\/\d{3}\s*$/, '')
    .trim()
  return name || description
}

export function planImport({ ledger, card, draft, newId }: PlanInput): ImportPlan {
  const todo = problems(draft)
  if (todo.length) throw new ImportError(todo[0])
  if (draft.cardId !== card.id) throw new ImportError('This import belongs to another card.')

  const txs = new Map(ledger.transactions.map((t) => [t.id, t]))
  const pays = new Map(ledger.payments.map((p) => [p.id, p]))
  const plans = new Map(ledger.plans.map((p) => [p.id, p]))
  const changedTx = new Set<string>()
  const changedPay = new Set<string>()
  const changedPlan = new Set<string>()
  const putTx = (t: Transaction) => (txs.set(t.id, t), changedTx.add(t.id))
  const putPay = (p: Payment) => (pays.set(p.id, p), changedPay.add(p.id))
  const putPlan = (p: InstallmentPlan) => (plans.set(p.id, p), changedPlan.add(p.id))
  const statements: Statement[] = []

  let unbilled = ledger.statements.find((s) => s.cardId === card.id && s.kind === 'unbilled')
  if (!unbilled) {
    unbilled = { id: `${card.id}-unbilled`, cardId: card.id, kind: 'unbilled' }
    statements.push(unbilled)
  }

  const report: ImportReport = {
    statementId: '',
    target: draft.target,
    difference: checkTotals(draft)?.difference ?? null,
    added: [],
    moved: [],
    movedPayments: [],
    kept: 0,
    removed: [],
    newPayments: [],
    notOnStatement: [],
    notOnStatementRowIds: [],
    missingPayments: [],
    links: [],
    conversions: [],
    skippedDuplicates: skippedKeys(draft).size,
    overlapMerged: draft.overlapMerged,
    backfill: false,
  }
  const skipped = skippedKeys(draft)
  const rows = draft.rows.filter((r) => !skipped.has(r.key))

  const newTx = (r: DraftRow, statementId: string): Transaction => {
    const kind = r.kind as TxKind
    const feeLike = kind === 'fee' || kind === 'interest'
    const t: Transaction = {
      id: newId('tx'),
      cardId: card.id,
      statementId,
      date: r.date,
      description: r.description,
      amount: r.amount,
      kind,
      ownerId: card.defaultOwnerId,
      // Fees and interest go to the card's default owner without a check (M-07); tagging (Slice 7) settles the rest.
      check: !(feeLike && card.defaultOwnerId !== null),
    }
    if (r.installment) t.installment = r.installment
    return t
  }
  const newPayment = (r: DraftRow, source: 'statement' | 'unbilled', statementId: string): Payment => ({
    id: newId('pay'),
    cardId: card.id,
    source,
    date: r.date,
    amount: -r.amount,
    statementId,
    allocations: [],
    description: r.description,
  })
  const asRead = (t: Transaction, r: DraftRow, statementId: string): Transaction => {
    const next: Transaction = { ...t, statementId, date: r.date, description: r.description, amount: r.amount, kind: r.kind as TxKind }
    if (r.installment) next.installment = r.installment
    return next
  }

  let statementId: string
  if (draft.target === 'unbilled') {
    statementId = unbilled.id
    for (const r of rows) {
      if (r.kind === 'payment') {
        const p = newPayment(r, 'unbilled', statementId)
        putPay(p)
        report.newPayments.push(summary(p))
      } else {
        const t = newTx(r, statementId)
        putTx(t)
        report.added.push(summary(t))
      }
    }
  } else {
    const statementDate = draft.statementDate!
    const billed = billedOf(ledger, card.id)
    const existing = billed.find((s) => s.statementDate.slice(0, 7) === statementDate.slice(0, 7))
    const later = billed.filter((s) => s !== existing && s.statementDate > statementDate)
    const backfill = later.length > 0
    report.backfill = backfill
    statementId = existing?.id ?? newId('stmt')
    const stmt: BilledStatement = { id: statementId, cardId: card.id, kind: 'billed', statementDate, dueDate: draft.dueDate!, printed: printedOf(draft)! }
    statements.push(stmt)

    const oldTx = [...txs.values()].filter((t) => existing && t.statementId === existing.id)
    const oldPay = [...pays.values()].filter((p) => existing && p.source === 'statement' && p.statementId === existing.id)
    // Backfilling an older month never touches Unbilled (phase-1 §3).
    const unbTx = backfill ? [] : [...txs.values()].filter((t) => t.statementId === unbilled!.id)
    const unbPay = backfill ? [] : [...pays.values()].filter((p) => p.source === 'unbilled' && p.statementId === unbilled!.id)
    const used = new Set<string>()
    const take = <T extends { id: string }>(list: T[], ok: (x: T) => boolean): T | undefined => {
      const hit = list.find((x) => !used.has(x.id) && ok(x))
      if (hit) used.add(hit.id)
      return hit
    }

    for (const r of rows) {
      if (r.kind === 'payment') {
        const amount = -r.amount
        const old = take(oldPay, (p) => p.date === r.date && p.amount === amount)
        if (old) {
          report.kept++
          putPay({ ...old, description: r.description })
          continue
        }
        const moving = take(unbPay, (p) => p.amount === amount && near(p.date, r.date, MOVE_WINDOW_DAYS))
        if (moving) {
          putPay({ ...moving, source: 'statement', statementId, date: r.date, description: r.description })
          report.movedPayments.push(summary(moving))
          continue
        }
        const p = newPayment(r, 'statement', statementId)
        putPay(p)
        report.newPayments.push(summary(p))
        continue
      }
      const old = take(oldTx, (t) => t.date === r.date && t.amount === r.amount && sameText(t.description, r.description))
      if (old) {
        report.kept++
        putTx(asRead(old, r, statementId))
        continue
      }
      const moving = take(unbTx, (t) => t.amount === r.amount && near(t.date, r.date, MOVE_WINDOW_DAYS) && sameText(t.description, r.description))
      if (moving) {
        putTx(asRead(moving, r, statementId))
        report.moved.push(summary(moving))
        continue
      }
      const t = newTx(r, statementId)
      putTx(t)
      report.added.push(summary(t))
    }

    // Re-import: what the new file no longer has is removed; payments on it go back to To assign.
    for (const t of oldTx.filter((x) => !used.has(x.id))) {
      const after = deleteTransaction({ transactions: [...txs.values()], payments: [...pays.values()] }, t.id)
      for (const p of after.payments) if (p !== pays.get(p.id)) putPay(p)
      txs.delete(t.id)
      changedTx.delete(t.id)
      report.removed.push(summary(t))
    }
    for (const line of oldPay.filter((x) => !used.has(x.id))) {
      for (const p of pays.values()) {
        if (p.linkedStatementLine === line.id) {
          const { linkedStatementLine: _l, ...rest } = p
          putPay(rest)
        }
      }
      pays.delete(line.id)
      changedPay.delete(line.id)
      report.removed.push({ date: line.date, description: line.description ?? 'Payment', amount: -line.amount })
    }

    // Installments: link each to its plan (same monthly amount and length, started n−1 months before), or start one.
    const start = (n: number) => monthOf(monthIndex(statementDate) - (n - 1))
    for (const t of [...txs.values()].filter((x) => x.statementId === statementId && x.kind === 'installment' && !x.planId)) {
      const inst = t.installment ?? parseInstallment(t.description)
      if (!inst) continue
      const found = [...plans.values()].find((p) => p.cardId === card.id && p.monthly === t.amount && p.total === inst.of && p.start === start(inst.n))
      const plan = found ?? { id: newId('plan'), cardId: card.id, ownerId: t.ownerId, name: planName(t.description), monthly: t.amount, total: inst.of, start: start(inst.n) }
      if (!found) putPlan(plan)
      putTx({ ...t, planId: plan.id, installment: inst })
    }

    // Installment conversion: REVERSAL CICILAN cancels the earlier purchase; its payments move to installment 1/N.
    for (const rev of [...txs.values()].filter((x) => x.statementId === statementId && x.kind === 'reversal' && !x.reverses)) {
      const ledgerNow: Ledger = { statements: [...ledger.statements, ...statements], transactions: [...txs.values()], payments: [...pays.values()], plans: [...plans.values()] }
      const result = convertToInstallment(ledgerNow, rev.id, newId('plan'))
      if ('error' in result) {
        report.conversions.push({ description: rev.description, ok: false, error: result.error })
        continue
      }
      result.transactions.forEach(putTx)
      result.payments.forEach(putPay)
      // A plan started by this import belongs to the purchase's owner; an existing plan keeps its owner.
      const isNew = !ledger.plans.some((p) => p.id === result.plan.id)
      if (isNew) putPlan({ ...result.plan, ownerId: txs.get(result.originalId)!.ownerId })
      report.conversions.push({ description: rev.description, ok: true })
    }
  }
  report.statementId = statementId

  // Hand-recorded payments ↔ bank payment lines, same amount within ±5 days (counted once).
  const links = matchManualPayments([...pays.values()].filter((p) => p.cardId === card.id))
  for (const p of applyLinks([...pays.values()], links)) if (p !== pays.get(p.id)) putPay(p)
  report.links = links

  const final: Ledger = { statements: [...ledger.statements.filter((s) => !statements.some((x) => x.id === s.id)), ...statements], transactions: [...txs.values()], payments: [...pays.values()], plans: [...plans.values()] }
  if (draft.target === 'statement' && !report.backfill) {
    const issues = draftIssues(final, statementId)
    report.notOnStatement = [
      ...issues.notOnStatementRows.map((id) => summary(txs.get(id)!)),
      ...issues.notOnStatementPayments.map((id) => summary({ ...pays.get(id)!, amount: -pays.get(id)!.amount })),
    ]
    report.notOnStatementRowIds = issues.notOnStatementRows
    report.missingPayments = issues.missingPayments.map((id) => summary(pays.get(id)!))
  }

  const deleteTransactions = ledger.transactions.filter((t) => !txs.has(t.id)).map((t) => t.id)
  const deletePayments = ledger.payments.filter((p) => !pays.has(p.id)).map((p) => p.id)
  return {
    statements,
    transactions: [...changedTx].map((id) => txs.get(id)!),
    payments: [...changedPay].map((id) => pays.get(id)!),
    plans: [...changedPlan].map((id) => plans.get(id)!),
    deleteTransactions,
    deletePayments,
    report,
  }
}
