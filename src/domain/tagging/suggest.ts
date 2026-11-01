// Owner suggestions (docs/intent/phase-1.md §5). Priority: manual → linked row (refund / reversal / installment 1
// follow the purchase) → installment plan → card rule → learned history (same merchant tagged the same way ≥2 times)
// → confident AI guess → weak history / unsure AI guess (Check) → card default owner (Check when "None").
// Marketplace purchases always keep Check. Every row gets an answer, with a confidence and a reason.
import type { Card, InstallmentPlan, Owner, TxKind } from '../types'
import { isMarketplace, normalizeMerchant } from './merchant'
import { confirmedLabels, describeMatch, pickRule } from './rules'
import { AI_CONFIDENT, type LabelledRow, type Suggestion, type TagRow, type TagRule } from './types'

export interface TagContext {
  /** Owners of the card (others are ignored). Archived owners are never suggested. */
  owners: readonly Owner[]
  rules: readonly TagRule[]
  plans?: readonly InstallmentPlan[]
}

type Draft = Omit<Suggestion, 'marketplace'>

const CHARGE_KINDS: readonly TxKind[] = ['purchase', 'installment']
const MARKETPLACE_NOTE = "Marketplace: the statement doesn't say who ordered"

/**
 * One suggestion per row, in order. `history` is the card's labelled past (stored transactions fit as is); rows
 * still waiting for a check and rows of other cards are not used.
 */
export function suggestOwners(card: Card, rows: readonly TagRow[], history: readonly LabelledRow[], ctx: TagContext): Suggestion[] {
  const owners = new Map(ctx.owners.filter((o) => o.cardId === card.id).map((o) => [o.id, o]))
  const usable = (id: string | null | undefined): id is string => !!id && owners.has(id) && !owners.get(id)!.archived
  const nameOf = (id: string) => owners.get(id)!.name
  const labels = confirmedLabels(history, card.id).filter((h) => usable(h.ownerId))
  const keyOf = normalizeMerchant
  /** Newest first (sorts the given array, always a fresh one here). */
  const newestFirst = <T extends { date: string }>(xs: T[]) => xs.sort((x, y) => y.date.localeCompare(x.date))
  const defaultId = usable(card.defaultOwnerId) ? card.defaultOwnerId : null

  // Rows follow at most two links (installment 1/N → reversal → purchase; refund → charge), and a row only follows
  // a row of another kind, so resolving can't loop.
  const resolve = (i: number): Suggestion => decide(i)

  /** A row in this batch (never a later one) or a past label that this row follows. */
  function linked(i: number, kinds: readonly TxKind[], same: (description: string, amount: number) => boolean): { batch?: number; past?: LabelledRow } {
    const row = rows[i]
    // Never a later row: a refund or reversal can only follow something already bought.
    const inBatch = newestFirst(rows.map((r, j) => ({ ...r, j })).filter((r) => kinds.includes(r.kind) && r.date <= row.date && same(r.description, r.amount)))[0]
    if (inBatch) return { batch: inBatch.j }
    const past = newestFirst(labels.filter((h) => kinds.includes(h.kind) && same(h.description, h.amount)))[0]
    return past ? { past } : {}
  }

  function link(found: { batch?: number; past?: LabelledRow }, reason: string, source: Suggestion['source']): Draft | undefined {
    if (found.batch !== undefined) {
      const s = resolve(found.batch)
      return { ownerId: s.ownerId, check: s.check, source, confidence: s.confidence, reason, follows: found.batch }
    }
    return found.past && { ownerId: found.past.ownerId, check: false, source, confidence: 0.9, reason }
  }

  function follow(i: number): Draft | undefined {
    const row = rows[i]
    const key = keyOf(row.description)
    const amount = Math.abs(row.amount)
    if (row.kind === 'refund') {
      return link(linked(i, CHARGE_KINDS, (d, a) => keyOf(d) === key && Math.abs(a) === amount), 'Same owner as the refunded purchase', 'auto')
    }
    if (row.kind === 'reversal') {
      const target = row.reverses && keyOf(row.reverses)
      const same = target ? (d: string) => keyOf(d) === target : (d: string, a: number) => keyOf(d) === key && Math.abs(a) === amount
      return link(linked(i, ['purchase'], same), 'Same owner as the purchase it cancels', 'auto')
    }
    if (row.kind === 'installment' && row.installment?.n === 1) {
      // Only a reversal in the same statement starts a plan.
      return link({ batch: linked(i, ['reversal'], (d) => keyOf(d) === key).batch }, 'Same owner as the purchase moved to installment', 'plan')
    }
    return undefined
  }

  function fallback(row: TagRow, note: string | undefined): Draft {
    const key = keyOf(row.description)
    const guess = row.aiGuess && usable(row.aiGuess.ownerId) ? { ...row.aiGuess, ownerId: row.aiGuess.ownerId as string } : undefined
    const byDefault = (): Draft =>
      defaultId
        ? { ownerId: defaultId, check: false, source: 'default', confidence: 0.6, reason: 'Card default owner' }
        : { ownerId: null, check: true, source: 'default', confidence: 0, reason: 'No rule or history matches and the card has no default owner' }
    if (row.kind === 'fee' || row.kind === 'interest') return byDefault()

    // Per owner: how many past labels, and the newest one's date (labels are read newest first).
    const counts = new Map<string, { n: number; last: string }>()
    let total = 0
    for (const h of newestFirst(labels.filter((x) => x.kind === 'purchase' && keyOf(x.description) === key))) {
      total++
      const c = counts.get(h.ownerId!) ?? { n: 0, last: h.date }
      counts.set(h.ownerId!, { n: c.n + 1, last: c.last })
    }
    const top = [...counts].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))[0]
    if (top && top[1].n >= 2 && top[1].n * 2 > total) {
      return { ownerId: top[0], check: false, source: 'auto', confidence: Math.min(0.9, top[1].n / total), reason: `Tagged ${nameOf(top[0])} ${top[1].n} of ${total} times before` }
    }
    if (guess && guess.confidence >= AI_CONFIDENT) return { ownerId: guess.ownerId, check: false, source: 'ai', confidence: guess.confidence, reason: 'AI guess' }
    if (top) {
      if (top[0] === defaultId && total === 1 && !note) return byDefault()
      const reason = top[1].n === 1 ? `Tagged ${nameOf(top[0])} once before` : 'Past labels disagree'
      return { ownerId: top[0], check: true, source: 'auto', confidence: 0.4, reason }
    }
    if (guess) return { ownerId: guess.ownerId, check: true, source: 'ai', confidence: guess.confidence, reason: 'AI guess, not sure' }
    return byDefault()
  }

  function decide(i: number): Suggestion {
    const row = rows[i]
    const marketplace = (row.kind === 'purchase' || row.kind === 'refund') && isMarketplace(row.description)
    if (row.manualOwnerId !== undefined) {
      return { ownerId: row.manualOwnerId, check: false, source: 'manual', confidence: 1, reason: 'Set by you', marketplace }
    }
    const followed = follow(i)
    // A linked row inherits the Check of the row it follows. A marketplace refund always keeps its own Check.
    if (followed) {
      return marketplace
        ? { ...followed, check: true, confidence: Math.min(followed.confidence, 0.5), reason: `${followed.reason}. ${MARKETPLACE_NOTE}`, marketplace }
        : { ...followed, marketplace }
    }

    const finish = (d: Draft): Suggestion =>
      marketplace ? { ...d, check: true, confidence: Math.min(d.confidence, 0.5), reason: `${d.reason}. ${MARKETPLACE_NOTE}`, marketplace } : { ...d, marketplace }

    if (row.kind === 'installment') {
      const plan = row.planId ? ctx.plans?.find((p) => p.id === row.planId && usable(p.ownerId)) : undefined
      if (plan) return finish({ ownerId: plan.ownerId, check: false, source: 'plan', confidence: 0.95, reason: `Installment plan "${plan.name}"` })
      const key = keyOf(row.description)
      const earlier = newestFirst(labels.filter((h) => h.kind === 'installment' && keyOf(h.description) === key))[0]
      if (earlier) return finish({ ownerId: earlier.ownerId, check: false, source: 'plan', confidence: 0.9, reason: 'Same owner as the earlier installments' })
    }

    const pick = pickRule(ctx.rules, card.id, row.description, usable)
    if (pick.rule) {
      const reason = `Rule: ${describeMatch(pick.rule)}`
      return finish(
        pick.conflict
          ? { ownerId: pick.rule.ownerId, check: true, source: 'rule', confidence: 0.5, reason: `${reason}. Rules disagree: "${describeMatch(pick.conflict)}" says ${nameOf(pick.conflict.ownerId)}`, ruleId: pick.rule.id }
          : { ownerId: pick.rule.ownerId, check: false, source: 'rule', confidence: 0.95, reason, ruleId: pick.rule.id },
      )
    }
    const note = pick.unusable && `Rule "${describeMatch(pick.unusable)}" is for an archived owner`
    const d = fallback(row, note)
    return finish(note ? { ...d, check: true, confidence: Math.min(d.confidence, 0.5), reason: `${d.reason}. ${note}` } : d)
  }

  return rows.map((_, i) => resolve(i))
}
