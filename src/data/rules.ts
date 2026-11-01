// Tagging rules and owner tags on stored rows (Settings → Tagging rules, the tag sheet). Matching and suggestion
// logic lives in src/domain/tagging; this file only reads and writes, every write checked by checkRecord.
import { applyRule, previewRule, withManualOwner, type RulePreview } from '../domain/tagging/apply'
import { ruleProblem, sameRule, type RuleDraft } from '../domain/tagging/rules'
import type { LabelledRow, TagRule } from '../domain/tagging/types'
import type { Payment, Transaction } from '../domain/types'
import { isCovered, paidRowIds, paymentsAfterOwnerChange, rowCover, type PaymentChoice, type RowCover } from './coverage'
import type { NewDb } from './db'
import { checkRecord } from './validate'

export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

let seq = 0
const newId = () => `rule-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** The card's rules, by pattern. */
export async function listRules(db: NewDb, cardId: string): Promise<TagRule[]> {
  const rules = await db.rules.where('cardId').equals(cardId).toArray()
  return rules.sort((a, b) => a.pattern.localeCompare(b.pattern) || a.match.localeCompare(b.match))
}

/**
 * Adds or updates a rule. A rule with the same card, match and pattern is replaced (its owner changes), so there is
 * never more than one rule per pattern. Returns the stored rule.
 */
export async function saveRule(
  db: NewDb,
  draft: RuleDraft,
  { now = new Date().toISOString(), origin = 'you' }: { now?: string; origin?: TagRule['origin'] } = {},
): Promise<TagRule> {
  return db.transaction('rw', [db.rules, db.owners], async () => {
    const owners = await db.owners.where('cardId').equals(draft.cardId).toArray()
    const problem = ruleProblem(draft, owners)
    if (problem) throw new RuleError(problem)
    if (draft.id && !(await db.rules.get(draft.id))) throw new RuleError('This rule no longer exists.')
    const twin = (await db.rules.where('cardId').equals(draft.cardId).toArray()).find((r) => r.id !== draft.id && sameRule(r, draft))
    const id = twin?.id ?? draft.id ?? newId()
    if (twin && draft.id) await db.rules.delete(draft.id)
    const rule: TagRule = { id, cardId: draft.cardId, match: draft.match, pattern: draft.pattern.trim().replace(/\s+/g, ' ').toUpperCase(), ownerId: draft.ownerId, updatedAt: now, origin }
    checkRecord('rules', rule)
    await db.rules.put(rule)
    return rule
  })
}

export async function deleteRule(db: NewDb, id: string): Promise<void> {
  await db.rules.delete(id)
}

/** Ids of the card's rows that something pays (a payment's assignment or a deposit). */
async function paidIds(db: NewDb, cardId: string): Promise<Set<string>> {
  return paidRowIds(await cardMoney(db, cardId))
}

/** How many rows of the card the rule would change (`except`: the row the rule was made from). */
export async function previewRuleOnCard(db: NewDb, rule: TagRule, except?: string): Promise<RulePreview> {
  const [rows, paid] = await Promise.all([db.transactions.where('cardId').equals(rule.cardId).toArray(), paidIds(db, rule.cardId)])
  return previewRule(rule, rows, except, paid)
}

/**
 * Applies the rule to the card's rows: rows that need a check or have no owner, plus rows that already have another
 * owner when `includeOwned`. Rows tagged by hand and rows a payment covers are never changed here. Re-reads rows and
 * payments in the same transaction, so it changes exactly what a preview made now would show. Returns the number of
 * rows changed.
 */
export async function applyRuleOnCard(db: NewDb, rule: TagRule, { includeOwned = false, except }: { includeOwned?: boolean; except?: string } = {}): Promise<number> {
  return db.transaction('rw', [db.transactions, db.payments], async () => {
    const changed = applyRule(rule, await previewRuleOnCard(db, rule, except), { includeOwned })
    changed.forEach((t) => checkRecord('transactions', t))
    await db.transactions.bulkPut(changed)
    return changed.length
  })
}

export type { PaymentChoice }

/** A payment covers the row and the owner changes, but no Keep / Unassign choice was given. */
export class PaymentChoiceNeeded extends RuleError {
  constructor() {
    super('A payment covers this charge. Choose "Keep payment" or "Unassign" first.')
    this.name = 'PaymentChoiceNeeded'
  }
}

/** The card's rows and payments, for what pays a row. */
async function cardMoney(db: NewDb, cardId: string): Promise<{ transactions: Transaction[]; payments: Payment[] }> {
  const [transactions, payments] = await Promise.all([db.transactions.where('cardId').equals(cardId).toArray(), db.payments.where('cardId').equals(cardId).toArray()])
  return { transactions, payments }
}

/** What pays the row: explicit assignments and deposits (rowCover). */
export async function coverOfRow(db: NewDb, tx: Pick<Transaction, 'id' | 'cardId'>): Promise<RowCover> {
  return rowCover(await cardMoney(db, tx.cardId), tx.id)
}

/**
 * The user picks the owner of one row (source You, Check cleared). `null` = nobody yet.
 * When something pays the row (an assignment or a deposit) and the owner changes, `payments` says what happens to it
 * (docs/intent/phase-1.md §6; see paymentsAfterOwnerChange):
 * - `keep` (X-05): the row stays paid by the payer's money, now owned by the new owner; deposit use becomes an
 *   explicit assignment.
 * - `unassign` (X-06): assignments to the row are removed (back to To assign, or the payment's deposit) and no
 *   deposit pays it any more, so the row is unpaid for the new owner.
 * Row and payments change in one transaction. Without a choice on a covered row it throws PaymentChoiceNeeded.
 */
export async function setOwner(db: NewDb, txId: string, ownerId: string | null, { payments }: { payments?: PaymentChoice } = {}): Promise<Transaction> {
  return db.transaction('rw', [db.transactions, db.owners, db.payments], async () => {
    const t = await db.transactions.get(txId)
    if (!t) throw new RuleError('This transaction no longer exists.')
    if (ownerId !== null) {
      const o = await db.owners.get(ownerId)
      if (!o || o.cardId !== t.cardId) throw new RuleError('Pick an owner of this card.')
      if (o.archived) throw new RuleError(`${o.name} is archived. Pick another owner.`)
    }
    if (ownerId !== t.ownerId) {
      const money = await cardMoney(db, t.cardId)
      if (isCovered(rowCover(money, t.id))) {
        if (!payments) throw new PaymentChoiceNeeded()
        const { changed } = paymentsAfterOwnerChange(money, t.id, payments)
        changed.forEach((p) => checkRecord('payments', p))
        await db.payments.bulkPut(changed)
      }
    }
    const next = withManualOwner(t, ownerId)
    checkRecord('transactions', next)
    await db.transactions.put(next)
    return next
  })
}

/** The card's labelled past, for suggestions and "Analyze my labels" (stored rows fit LabelledRow as is). */
export async function labelHistory(db: NewDb, cardId: string): Promise<LabelledRow[]> {
  return db.transactions.where('cardId').equals(cardId).toArray()
}

// ---- dismissed "Analyze my labels" suggestions (with the user's comment for the next analysis) ----

export const DISMISSED_PREFIX = 'tagging-dismissed:'

export interface Dismissal {
  match: TagRule['match']
  pattern: string
  ownerId: string
  comment?: string
  at: string
}

export async function listDismissals(db: NewDb, cardId: string): Promise<Dismissal[]> {
  const v = (await db.meta.get(DISMISSED_PREFIX + cardId))?.value
  return Array.isArray(v) ? (v as Dismissal[]) : []
}

export async function dismissSuggestion(db: NewDb, cardId: string, d: Dismissal): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const list = await listDismissals(db, cardId)
    const comment = d.comment?.trim()
    const item: Dismissal = { match: d.match, pattern: d.pattern, ownerId: d.ownerId, at: d.at, ...(comment && { comment: comment.slice(0, 300) }) }
    await db.meta.put({ key: DISMISSED_PREFIX + cardId, value: [...list, item].slice(-50) })
  })
}
