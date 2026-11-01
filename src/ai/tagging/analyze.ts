// "Analyze my labels" (docs/intent/phase-1.md §5): one Claude request over the card's labelled history that proposes
// tagging rules. The user reviews each one (Accept / Edit / Dismiss). Only merchant names, sample statement lines
// and owner names are sent; no amounts, dates or card details. Evidence ("N of M past rows agree") is counted on
// the device, never taken from the answer. The API key is only ever put in the request header.
import { isMarketplace, normalizeMerchant } from '../../domain/tagging/merchant'
import { confirmedLabels, vetProposals, type Proposal, type VettedProposal } from '../../domain/tagging/rules'
import { RULE_MATCHES, type LabelledRow, type RuleMatch, type TagRule } from '../../domain/tagging/types'
import type { Owner } from '../../domain/types'
import { AI_CACHE_PREFIX } from '../../data/aiCache'
import type { NewDb } from '../../data/db'

export const ANALYZE_PROMPT_VERSION = 'analyze-labels-1'
export const ANALYZE_CACHE_PREFIX = `${AI_CACHE_PREFIX}analyze-labels:`
export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
/** At most this many merchants go into one request (most-labelled first). */
export const MAX_GROUPS = 150
/** Only the newest answers are kept in the cache. */
export const MAX_CACHED = 200

export class AnalyzeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyzeError'
  }
}

export interface AnalyzeInput {
  cardId: string
  /** The card's owners; archived ones are left out of the request. */
  owners: readonly Owner[]
  history: readonly LabelledRow[]
  rules: readonly TagRule[]
  /** Suggestions the user dismissed before, with their comments for this analysis. */
  dismissed?: readonly { match: RuleMatch; pattern: string; ownerId: string; comment?: string }[]
}

export interface AnalyzeOptions {
  apiKey: string
  model: string
  fetch?: typeof fetch
  /** Where answers are cached (meta table, `ai-cache:` prefix). */
  db?: NewDb
}

export interface MerchantGroup {
  merchant: string
  examples: string[]
  owners: Record<string, number>
}

export interface AnalyzePayload {
  owners: string[]
  merchants: MerchantGroup[]
  existingRules: { match: RuleMatch; pattern: string; owner: string }[]
  dismissed: { match: RuleMatch; pattern: string; owner: string; comment?: string }[]
}

const SYSTEM = `You help a household split a shared credit card bill. Each statement line is tagged with the person (owner) who pays for it.
You get the merchants on one card with how often each owner was tagged, a few sample statement lines, the rules that already exist, and suggestions the user dismissed (with their comments).
Propose tagging rules that would tag future lines correctly:
- "startsWith" when the sample lines start with a fixed prefix (e.g. "GRAB*"), otherwise "contains" with a short distinctive part of the merchant name (e.g. "NETFLIX").
- Only propose a rule when one owner clearly dominates that merchant. Never propose rules for marketplaces (Shopee, Tokopedia, Lazada, TikTok Shop): their lines don't say who ordered.
- Don't repeat existing rules or dismissed suggestions; take the user's comments into account.
- "owner" must be one of the given owner names. "reason" is one short sentence in English.
Return an empty list when nothing qualifies.`

const ownerSchema = (names: string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['rules'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['match', 'pattern', 'owner', 'reason'],
        properties: {
          match: { type: 'string', enum: [...RULE_MATCHES] },
          pattern: { type: 'string' },
          owner: { type: 'string', enum: names },
          reason: { type: 'string' },
        },
      },
    },
  },
})

/**
 * The card's active owners whose name is unique on the card (case-insensitive). Owners sharing a name can't be told
 * apart in the answer, so they are left out of the analysis.
 */
function activeOwners(input: Pick<AnalyzeInput, 'cardId' | 'owners'>): Owner[] {
  const active = input.owners.filter((o) => o.cardId === input.cardId && !o.archived)
  const count = new Map<string, number>()
  for (const o of active) count.set(o.name.trim().toLowerCase(), (count.get(o.name.trim().toLowerCase()) ?? 0) + 1)
  return active.filter((o) => count.get(o.name.trim().toLowerCase()) === 1)
}

/** What is sent: merchants with at least 2 confirmed labels, by owner name. Marketplaces are left out. */
export function buildPayload(input: AnalyzeInput): AnalyzePayload {
  const active = activeOwners(input)
  const name = new Map(input.owners.map((o) => [o.id, o.name]))
  const activeIds = new Set(active.map((o) => o.id))
  const groups = new Map<string, MerchantGroup & { n: number }>()
  for (const h of confirmedLabels(input.history, input.cardId)) {
    if (!activeIds.has(h.ownerId!) || isMarketplace(h.description) || h.kind === 'fee' || h.kind === 'interest') continue
    const merchant = normalizeMerchant(h.description)
    const g = groups.get(merchant) ?? { merchant, examples: [], owners: {}, n: 0 }
    const who = name.get(h.ownerId!)!
    g.owners[who] = (g.owners[who] ?? 0) + 1
    g.n++
    if (g.examples.length < 3 && !g.examples.includes(h.description)) g.examples.push(h.description)
    groups.set(merchant, g)
  }
  const merchants = [...groups.values()]
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.n - a.n || a.merchant.localeCompare(b.merchant))
    .slice(0, MAX_GROUPS)
    .map(({ n: _n, ...g }) => g)
  const ownerName = (id: string) => name.get(id) ?? id
  return {
    owners: active.map((o) => o.name),
    merchants,
    existingRules: input.rules.filter((r) => r.cardId === input.cardId).map((r) => ({ match: r.match, pattern: r.pattern, owner: ownerName(r.ownerId) })),
    dismissed: (input.dismissed ?? []).map((d) => ({ match: d.match, pattern: d.pattern, owner: ownerName(d.ownerId), ...(d.comment && { comment: d.comment }) })),
  }
}

/** The Messages API request body: strict JSON schema output. */
export function buildRequest(model: string, payload: AnalyzePayload) {
  return {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ownerSchema(payload.owners) } },
  }
}

export interface RawRule {
  match: RuleMatch
  pattern: string
  owner: string
  reason: string
}

const BAD_ANSWER = 'The AI answer was not in the expected format. Nothing was changed. Try again.'

/** The `rules` list of an answer, checked field by field. Throws AnalyzeError when the shape is wrong. */
export function parseRules(value: unknown): RawRule[] {
  const rules = (value as { rules?: unknown } | null)?.rules
  if (!Array.isArray(rules)) throw new AnalyzeError(BAD_ANSWER)
  return rules.map((r: unknown) => {
    const x = r as Partial<RawRule> | null
    if (typeof x !== 'object' || x === null || !RULE_MATCHES.includes(x.match as RuleMatch) || typeof x.pattern !== 'string' || typeof x.owner !== 'string' || typeof x.reason !== 'string') {
      throw new AnalyzeError(BAD_ANSWER)
    }
    return { match: x.match as RuleMatch, pattern: x.pattern, owner: x.owner, reason: x.reason }
  })
}

/** The rules from a Messages API response body. */
export function readAnswer(body: unknown): RawRule[] {
  const b = body as { stop_reason?: string; content?: { type?: string; text?: string }[] } | null
  if (b?.stop_reason === 'refusal') throw new AnalyzeError('The AI declined this request. Nothing was changed.')
  if (b?.stop_reason === 'max_tokens') throw new AnalyzeError('The AI answer was cut off. Nothing was changed. Try again.')
  const text = Array.isArray(b?.content) ? b.content.find((c) => c?.type === 'text')?.text : undefined
  if (typeof text !== 'string') throw new AnalyzeError(BAD_ANSWER)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new AnalyzeError(BAD_ANSWER)
  }
  return parseRules(json)
}

function httpProblem(status: number): string {
  if (status === 401 || status === 403) return 'The API key was not accepted. Check it in Settings → AI.'
  if (status === 429) return 'The AI is busy right now (rate limit). Try again in a minute.'
  if (status >= 500) return 'The AI service is not available right now. Try again later.'
  return `The AI request failed (HTTP ${status}).`
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cache key: prompt version + model + exactly what is sent. */
export async function cacheKey(model: string, payload: AnalyzePayload): Promise<string> {
  return ANALYZE_CACHE_PREFIX + (await sha256(JSON.stringify({ v: ANALYZE_PROMPT_VERSION, system: SYSTEM, model, payload })))
}

async function ask(payload: AnalyzePayload, opts: AnalyzeOptions): Promise<RawRule[]> {
  const key = opts.db ? await cacheKey(opts.model, payload) : undefined
  if (opts.db && key) {
    const hit = (await opts.db.meta.get(key))?.value
    if (hit !== undefined) {
      try {
        return parseRules(hit)
      } catch {
        // A damaged cache entry is ignored and replaced below.
      }
    }
  }
  const doFetch = opts.fetch ?? globalThis.fetch
  let res: Response
  try {
    res = await doFetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildRequest(opts.model, payload)),
    })
  } catch {
    throw new AnalyzeError('Could not reach the AI. Check your connection and try again.')
  }
  if (!res.ok) throw new AnalyzeError(httpProblem(res.status))
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new AnalyzeError(BAD_ANSWER)
  }
  const rules = readAnswer(body)
  if (opts.db && key) {
    const db = opts.db
    await db.transaction('rw', db.meta, async () => {
      await db.meta.put({ key, value: { rules, at: Date.now() } })
      const entries = await db.meta.where('key').startsWith(ANALYZE_CACHE_PREFIX).toArray()
      const at = (v: unknown) => Number((v as { at?: unknown } | null)?.at) || 0
      const old = entries.sort((a, b) => at(b.value) - at(a.value) || a.key.localeCompare(b.key)).slice(MAX_CACHED)
      await db.meta.bulkDelete(old.map((e) => e.key))
    })
  }
  return rules
}

/**
 * Suggested rules for the card, vetted on the device (see vetProposals). Makes no request when there is nothing to
 * analyse (no merchant labelled at least twice) or when the same request was answered before (cache).
 */
export async function analyzeLabels(input: AnalyzeInput, opts: AnalyzeOptions): Promise<VettedProposal[]> {
  if (!opts.apiKey.trim()) throw new AnalyzeError('Add your Anthropic API key in Settings → AI first.')
  const payload = buildPayload(input)
  if (!payload.merchants.length) return []
  const raw = await ask(payload, opts)
  const byName = new Map(activeOwners(input).map((o) => [o.name.trim().toLowerCase(), o.id]))
  const proposals: Proposal[] = raw.flatMap((r) => {
    const ownerId = byName.get(r.owner.trim().toLowerCase())
    return ownerId ? [{ match: r.match, pattern: r.pattern, ownerId, reason: r.reason.trim().slice(0, 200) }] : []
  })
  return vetProposals(proposals, { cardId: input.cardId, owners: input.owners, rules: input.rules, history: input.history, dismissed: input.dismissed })
}
