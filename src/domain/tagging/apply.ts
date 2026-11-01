// Applying tags to stored transactions: a suggestion, a manual owner, or a rule over existing rows.
import type { Transaction } from '../types'
import { isMarketplace } from './merchant'
import { ruleMatches } from './rules'
import type { Suggestion, TagRule } from './types'

const keepsCheck = (t: Transaction) => (t.kind === 'purchase' || t.kind === 'refund') && isMarketplace(t.description)

/** The transaction with the suggestion's owner, Check dot and source. */
export function withSuggestion(t: Transaction, s: Suggestion): Transaction {
  const { check: _check, ...rest } = t
  return { ...rest, ownerId: s.ownerId, tagSource: s.source, ...(s.check && { check: true }) }
}

/** The user picked the owner: source You, Check cleared (also on marketplace rows: the user has looked). */
export function withManualOwner(t: Transaction, ownerId: string | null): Transaction {
  const { check: _check, ...rest } = t
  return { ...rest, ownerId, tagSource: 'manual' }
}

export interface RulePreview {
  /** Matching rows that need a check or have no owner: changed by default. */
  unsure: Transaction[]
  /** Matching rows that already have another owner (not set by hand): changed only when the user opts in. */
  owned: Transaction[]
  /** Matching rows the user tagged by hand with another owner: never changed by a rule. */
  manual: number
  /** Matching rows a payment already covers: never changed in bulk (changed one by one, see the row sheet). */
  paid: number
}

/**
 * Which rows of the rule's card a rule would change. `except`: the row the rule was made from; `paidIds`: rows a
 * payment covers.
 */
export function previewRule(rule: TagRule, transactions: readonly Transaction[], except?: string, paidIds: ReadonlySet<string> = new Set()): RulePreview {
  const unsure: Transaction[] = []
  const owned: Transaction[] = []
  let manual = 0
  let paid = 0
  for (const t of transactions) {
    if (t.cardId !== rule.cardId || t.id === except || !ruleMatches(rule, t.description)) continue
    const sameOwner = t.ownerId === rule.ownerId
    const unsureRow = !!t.check || t.ownerId === null
    // A marketplace row keeps its Check, so it changes only when the owner does.
    const changes = unsureRow ? !(sameOwner && keepsCheck(t)) : !sameOwner
    if (!changes) continue
    if (t.tagSource === 'manual') manual++
    else if (paidIds.has(t.id)) paid++
    else (unsureRow ? unsure : owned).push(t)
  }
  return { unsure, owned, manual, paid }
}

/** The changed rows: owner from the rule, source Rule, Check cleared (kept on marketplace rows). */
export function applyRule(rule: TagRule, preview: RulePreview, { includeOwned = false }: { includeOwned?: boolean } = {}): Transaction[] {
  return [...preview.unsure, ...(includeOwned ? preview.owned : [])].map((t) => {
    const { check: _check, ...rest } = t
    return { ...rest, ownerId: rule.ownerId, tagSource: 'rule' as const, ...(keepsCheck(t) && { check: true }) }
  })
}
