// Tagging rules: matching, conflicts, validation, and their evidence in past labels.
import type { Owner } from '../types'
import { canonical, isMarketplace, normalizeMerchant } from './merchant'
import { RULE_MATCHES, type LabelledRow, type RuleMatch, type TagRule } from './types'

export const cleanPattern = (pattern: string) => canonical(pattern)

/** True when the rule's pattern matches the statement line or its merchant name. */
export function ruleMatches(rule: Pick<TagRule, 'match' | 'pattern'>, description: string): boolean {
  const p = cleanPattern(rule.pattern)
  if (!p) return false
  return [canonical(description), normalizeMerchant(description)].some((t) => (rule.match === 'startsWith' ? t.startsWith(p) : t.includes(p)))
}

/** More specific first: longer pattern, then "starts with", then the newest change, then id. */
export function bySpecificity(a: TagRule, b: TagRule): number {
  return (
    cleanPattern(b.pattern).length - cleanPattern(a.pattern).length ||
    Number(b.match === 'startsWith') - Number(a.match === 'startsWith') ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  )
}

export interface RulePick {
  rule?: TagRule
  /** The two most specific matching rules point to different owners. */
  conflict?: TagRule
  /** A matching rule whose owner is archived or not on the card (ignored). */
  unusable?: TagRule
}

/** The rule that tags `description` on `cardId`. Rules of other cards never apply. */
export function pickRule(rules: readonly TagRule[], cardId: string, description: string, usable: (ownerId: string) => boolean): RulePick {
  const matching = rules.filter((r) => r.cardId === cardId && ruleMatches(r, description)).sort(bySpecificity)
  const ok = matching.filter((r) => usable(r.ownerId))
  const unusable = matching.find((r) => !usable(r.ownerId))
  const [rule, next] = ok
  const conflict =
    rule && next && next.ownerId !== rule.ownerId && cleanPattern(next.pattern).length === cleanPattern(rule.pattern).length && next.match === rule.match ? next : undefined
  return { ...(rule && { rule }), ...(conflict && { conflict }), ...(!rule && unusable ? { unusable } : {}) }
}

export interface RuleDraft {
  id?: string
  cardId: string
  match: RuleMatch
  pattern: string
  ownerId: string
}

/** Checks a rule before it is saved; returns the problem in plain English, or null. */
export function ruleProblem(d: RuleDraft, owners: readonly Owner[]): string | null {
  if (!RULE_MATCHES.includes(d.match)) return 'Pick "Starts with" or "Contains".'
  const p = cleanPattern(d.pattern)
  if (p.length < 2) return 'Type at least 2 letters of the merchant.'
  const owner = owners.find((o) => o.id === d.ownerId && o.cardId === d.cardId)
  if (!owner) return 'Pick who this merchant belongs to.'
  if (owner.archived) return `${owner.name} is archived. Pick another owner.`
  return null
}

/** Same card, same kind of match, same pattern: one replaces the other. */
export const sameRule = (a: Pick<TagRule, 'cardId' | 'match' | 'pattern'>, b: Pick<TagRule, 'cardId' | 'match' | 'pattern'>) =>
  a.cardId === b.cardId && a.match === b.match && cleanPattern(a.pattern) === cleanPattern(b.pattern)

/** "Starts with GRAB*" */
export const describeMatch = (r: Pick<TagRule, 'match' | 'pattern'>) => `${r.match === 'startsWith' ? 'Starts with' : 'Contains'} ${cleanPattern(r.pattern)}`

/** Past confirmed labels on the card: rows that still need a check or have no owner are not evidence. */
export function confirmedLabels(history: readonly LabelledRow[], cardId: string): LabelledRow[] {
  return history.filter((h) => (h.cardId === undefined || h.cardId === cardId) && !h.check && h.ownerId !== null)
}

export interface Evidence {
  /** Past rows the rule matches that have the rule's owner. */
  agree: number
  /** Past rows the rule matches. */
  total: number
}

/** "N of M past rows agree". */
export function ruleEvidence(rule: Pick<TagRule, 'cardId' | 'match' | 'pattern' | 'ownerId'>, history: readonly LabelledRow[]): Evidence {
  const matched = confirmedLabels(history, rule.cardId).filter((h) => ruleMatches(rule, h.description))
  return { agree: matched.filter((h) => h.ownerId === rule.ownerId).length, total: matched.length }
}

export const evidenceText = (e: Evidence) => `${e.agree} of ${e.total} past row${e.total === 1 ? '' : 's'} agree`

export interface Proposal {
  match: RuleMatch
  pattern: string
  ownerId: string
  /** Why the AI suggests it (shown under the evidence). */
  reason?: string
}

export interface VettedProposal extends Proposal, Evidence {
  cardId: string
}

export interface VetContext {
  cardId: string
  owners: readonly Owner[]
  rules: readonly TagRule[]
  history: readonly LabelledRow[]
  /** Suggestions the user dismissed before (never suggested again). */
  dismissed?: readonly Pick<TagRule, 'match' | 'pattern' | 'ownerId'>[]
}

/**
 * Keeps the suggestions worth showing, with evidence counted here (never taken from the AI): at least 2 past rows
 * agree and they are the majority; not a marketplace; owner active on this card; not already a rule; not dismissed.
 */
export function vetProposals(proposals: readonly Proposal[], ctx: VetContext): VettedProposal[] {
  const out: VettedProposal[] = []
  for (const p of proposals) {
    const draft = { ...p, cardId: ctx.cardId, pattern: cleanPattern(p.pattern) }
    if (ruleProblem(draft, ctx.owners)) continue
    if (isMarketplace(draft.pattern)) continue
    if (ctx.rules.some((r) => sameRule(r, draft))) continue
    if (out.some((o) => sameRule(o, draft))) continue
    if (ctx.dismissed?.some((d) => sameRule({ ...d, cardId: ctx.cardId }, draft) && d.ownerId === draft.ownerId)) continue
    const ev = ruleEvidence(draft, ctx.history)
    if (ev.agree < 2 || ev.agree * 2 <= ev.total) continue
    out.push({ ...draft, ...ev })
  }
  return out.sort((a, b) => b.agree - a.agree || a.pattern.localeCompare(b.pattern))
}
