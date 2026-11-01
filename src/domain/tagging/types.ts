// Tagging types (docs/intent/phase-1.md §5). Pure data: no React, no Dexie.
import type { ISODate, Rupiah, TagSource, TxKind } from '../types'

export type { TagSource }

export type RuleMatch = 'startsWith' | 'contains'
export const RULE_MATCHES: readonly RuleMatch[] = ['startsWith', 'contains']

/** "Starts with GRAB* → Andi" on one card. Rules never apply on another card. */
export interface TagRule {
  id: string
  cardId: string
  match: RuleMatch
  /** Compared without case against the statement line and its cleaned-up merchant name. */
  pattern: string
  ownerId: string
  /** ISO timestamp of the last change; the newer of two equally specific rules wins. */
  updatedAt: string
  /** Where the rule came from: the tag sheet / rules screen, or an accepted "Analyze my labels" suggestion. */
  origin?: 'you' | 'analyze'
}

/** A row to tag: an imported line (Slice 6) or a stored transaction. */
export interface TagRow {
  description: string
  kind: TxKind
  /** Signed rupiah: charges > 0, refunds and reversals < 0. */
  amount: Rupiah
  date: ISODate
  /** On a reversal: the description of the purchase it cancels, when the import knows it. */
  reverses?: string
  installment?: { n: number; of: number }
  planId?: string
  /** The owner the user set by hand. Kept as is. */
  manualOwnerId?: string | null
  /** The import's AI guess (owner already mapped to an id of this card). */
  aiGuess?: { ownerId: string | null; confidence: number }
}

/** A past row with the owner it ended up with. A stored Transaction fits as is. */
export interface LabelledRow {
  description: string
  kind: TxKind
  amount: Rupiah
  date: ISODate
  ownerId: string | null
  /** When set, rows of other cards are ignored. */
  cardId?: string
  /** Still waiting for a check: not a confirmed label. */
  check?: boolean
  /** Only `manual` (or unset: reviewed before tag sources existed) counts as a confirmed label. */
  tagSource?: TagSource
}

export interface Suggestion {
  ownerId: string | null
  /** Yellow "Check" dot. */
  check: boolean
  source: TagSource
  /** 0..1, how sure the engine is. */
  confidence: number
  /** Plain-English reason, e.g. "Rule: starts with GRAB*". */
  reason: string
  /** The rule that decided the owner. */
  ruleId?: string
  /** Index (in the same batch) of the row whose owner this one follows: refund → purchase, reversal → purchase, installment 1 → reversal. */
  follows?: number
  /** Shopee, Tokopedia…: the line doesn't say who ordered, so it always asks for a check and never offers a rule. */
  marketplace: boolean
}

/** AI guesses below this confidence keep the Check dot. */
export const AI_CONFIDENT = 0.7
