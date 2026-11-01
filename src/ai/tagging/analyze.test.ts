import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { LabelledRow, TagRule } from '../../domain/tagging/types'
import type { Owner } from '../../domain/types'
import { freshNewDb } from '../../../test/data/oldDb'
import { clearAiCache } from '../../data/aiCache'
import { ANALYZE_CACHE_PREFIX, AnalyzeError, MAX_CACHED, analyzeLabels, buildPayload, buildRequest, MESSAGES_URL, parseRules, readAnswer, type AnalyzeInput } from './analyze'

// Synthetic card "A": Andi, Sari, Bima (archived). Fake key: never a real one.
const KEY = 'sk-ant-test-0000000000000000'
const owners: Owner[] = [
  { id: 'a-andi', cardId: 'A', name: 'Andi' },
  { id: 'a-sari', cardId: 'A', name: 'Sari' },
  { id: 'a-bima', cardId: 'A', name: 'Bima', archived: true },
  { id: 'b-andi', cardId: 'B', name: 'Andi' },
]
const past = (description: string, ownerId: string | null, extra: Partial<LabelledRow> = {}): LabelledRow => ({
  description, kind: 'purchase', amount: 9000, date: '2026-09-01', ownerId, cardId: 'A', ...extra,
})
const history: LabelledRow[] = [
  past('GRAB* A-1 JAKARTA PUSATID', 'a-andi'),
  past('GRAB* A-2 JAKARTA SELATID', 'a-andi'),
  past('GRAB* A-3 JAKARTA SELATID', 'a-andi'),
  past('GRAB* A-4 JAKARTA SELATID', 'a-andi'),
  past('GRAMEDIA MATRAMAN', 'a-sari'),
  past('GRAMEDIA MATRAMAN', 'a-sari'),
  past('SHOPEE.CO.ID *AP1', 'a-sari'),
  past('SHOPEE.CO.ID *AP2', 'a-sari'),
  past('KIDZANIA', 'a-bima'),
  past('KIDZANIA', 'a-bima'),
  past('ONCE ONLY', 'a-sari'),
  past('BIAYA ADM KARTU', 'a-andi', { kind: 'fee' }),
  past('BIAYA ADM KARTU', 'a-andi', { kind: 'fee' }),
  past('HALODOC', 'a-sari', { check: true }),
  past('HALODOC', 'a-sari', { check: true }),
  past('OTHER CARD', 'b-andi', { cardId: 'B' }),
  past('OTHER CARD', 'b-andi', { cardId: 'B' }),
]
const rules: TagRule[] = [{ id: 'r', cardId: 'A', match: 'contains', pattern: 'NETFLIX', ownerId: 'a-andi', updatedAt: '2026-10-01T00:00:00.000Z' }]
const input: AnalyzeInput = { cardId: 'A', owners, history, rules, dismissed: [{ match: 'contains', pattern: 'KCI', ownerId: 'a-sari', comment: 'KCI is shared' }] }

const answer = (rulesOut: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ rules: rulesOut }) }], ...extra,
})
const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

describe('T-08 Analyze my labels (AI)', () => {
  it('sends only merchants labelled at least twice by active owners, no marketplaces, fees, other cards or unchecked rows', () => {
    const p = buildPayload(input)
    expect(p).toEqual({
      owners: ['Andi', 'Sari'],
      merchants: [
        { merchant: 'GRAB', examples: ['GRAB* A-1 JAKARTA PUSATID', 'GRAB* A-2 JAKARTA SELATID', 'GRAB* A-3 JAKARTA SELATID'], owners: { Andi: 4 } },
        { merchant: 'GRAMEDIA MATRAMAN', examples: ['GRAMEDIA MATRAMAN'], owners: { Sari: 2 } },
      ],
      existingRules: [{ match: 'contains', pattern: 'NETFLIX', owner: 'Andi' }],
      dismissed: [{ match: 'contains', pattern: 'KCI', owner: 'Sari', comment: 'KCI is shared' }],
    })
    expect(buildPayload({ ...input, dismissed: undefined, rules: [{ ...rules[0], ownerId: 'gone' }] })).toMatchObject({ existingRules: [{ owner: 'gone' }], dismissed: [] })
  })

  it('builds a Messages request with a strict JSON schema limited to the owner names', () => {
    const body = buildRequest('claude-opus-5-5', buildPayload(input))
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.output_config.format.type).toBe('json_schema')
    const item = body.output_config.format.schema.properties.rules.items
    expect(item.additionalProperties).toBe(false)
    expect(item.properties.owner.enum).toEqual(['Andi', 'Sari'])
    expect(item.properties.match.enum).toEqual(['startsWith', 'contains'])
    expect(JSON.parse(body.messages[0].content).merchants).toHaveLength(2)
  })

  it('one request with the key in the header only; suggestions come back vetted, with evidence counted on the device', async () => {
    const fetch = okFetch(
      answer([
        { match: 'startsWith', pattern: 'GRAB*', owner: 'Andi', reason: ' Rides are Andi. ' },
        { match: 'contains', pattern: 'GRAMEDIA', owner: 'sari', reason: 'Books' },
        { match: 'contains', pattern: 'SHOPEE', owner: 'Sari', reason: 'Marketplace' },
        { match: 'contains', pattern: 'KIDZANIA', owner: 'Bima', reason: 'Archived owner' },
        { match: 'contains', pattern: 'NETFLIX', owner: 'Andi', reason: 'Already a rule' },
      ]),
    )
    const out = await analyzeLabels(input, { apiKey: KEY, model: 'claude-sonnet-5-5', fetch })
    expect(out).toEqual([
      { cardId: 'A', match: 'startsWith', pattern: 'GRAB*', ownerId: 'a-andi', reason: 'Rides are Andi.', agree: 4, total: 4 },
      { cardId: 'A', match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-sari', reason: 'Books', agree: 2, total: 2 },
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MESSAGES_URL)
    expect(init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' })
    expect(String(init.body)).not.toContain(KEY)
    expect(JSON.parse(String(init.body)).model).toBe('claude-sonnet-5-5')
  })

  it('caches the answer under ai-cache: (same history + model → no second request)', async () => {
    const db = freshNewDb()
    const fetch = okFetch(answer([{ match: 'contains', pattern: 'GRAMEDIA', owner: 'Sari', reason: 'Books' }]))
    const opts = { apiKey: KEY, model: 'claude-opus-5-5', fetch, db }
    const first = await analyzeLabels(input, opts)
    expect(await analyzeLabels(input, opts)).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    const keys = (await db.meta.toArray()).map((m) => m.key)
    expect(keys).toHaveLength(1)
    expect(keys[0].startsWith(ANALYZE_CACHE_PREFIX)).toBe(true)
    expect(JSON.stringify(await db.meta.toArray())).not.toContain(KEY)

    await analyzeLabels(input, { ...opts, model: 'claude-haiku-5-5' })
    expect(fetch).toHaveBeenCalledTimes(2)
    // A damaged entry is ignored and replaced.
    await db.meta.put({ key: keys[0], value: { rules: 'nope' } })
    await analyzeLabels(input, opts)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(await clearAiCache(db)).toBe(2)
  })

  it('keeps only the newest cached answers', async () => {
    const db = freshNewDb()
    await db.meta.bulkPut([
      ...Array.from({ length: MAX_CACHED }, (_, i) => ({ key: `${ANALYZE_CACHE_PREFIX}old-${String(i).padStart(3, '0')}`, value: { rules: [], at: i + 1 } })),
      { key: `${ANALYZE_CACHE_PREFIX}no-time`, value: null },
      { key: 'ai-cache:import:keep', value: { other: true } },
    ])
    await analyzeLabels(input, { apiKey: KEY, model: 'm', fetch: okFetch(answer([])), db })
    const keys = (await db.meta.toArray()).map((m) => m.key)
    expect(keys.filter((k) => k.startsWith(ANALYZE_CACHE_PREFIX))).toHaveLength(MAX_CACHED)
    expect(keys).not.toContain(`${ANALYZE_CACHE_PREFIX}no-time`)
    expect(keys).not.toContain(`${ANALYZE_CACHE_PREFIX}old-000`)
    expect(keys).toContain(`${ANALYZE_CACHE_PREFIX}old-199`)
    expect(keys).toContain('ai-cache:import:keep') // other AI caches are not touched
  })

  it('owners sharing a name (any case) are left out, so an answer can never pick the wrong one', async () => {
    const twins: Owner[] = [...owners, { id: 'a-sari2', cardId: 'A', name: ' sari ' }]
    const p = buildPayload({ ...input, owners: twins })
    expect(p.owners).toEqual(['Andi'])
    expect(p.merchants.map((m) => m.merchant)).toEqual(['GRAB'])
    const out = await analyzeLabels({ ...input, owners: twins }, { apiKey: KEY, model: 'm', fetch: okFetch(answer([{ match: 'contains', pattern: 'GRAMEDIA', owner: 'Sari', reason: '' }])) })
    expect(out).toEqual([])
  })

  it('no request when there is nothing to analyse; no key → clear message', async () => {
    const fetch = okFetch(answer([]))
    expect(await analyzeLabels({ ...input, history: history.slice(0, 1) }, { apiKey: KEY, model: 'm', fetch })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    await expect(analyzeLabels(input, { apiKey: ' ', model: 'm', fetch })).rejects.toThrow('Add your Anthropic API key in Settings → AI first.')
  })

  it('bad AI JSON: readable error, nothing cached', async () => {
    const db = freshNewDb()
    const bad = (text: string) => vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 }))
    for (const text of ['not json {', JSON.stringify({ rules: 'x' }), JSON.stringify({ rules: [{ match: 'equals', pattern: 'X', owner: 'Andi', reason: '' }] }), JSON.stringify(null)]) {
      await expect(analyzeLabels(input, { apiKey: KEY, model: 'm', fetch: bad(text), db })).rejects.toThrow('The AI answer was not in the expected format. Nothing was changed. Try again.')
    }
    const notJsonBody = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(analyzeLabels(input, { apiKey: KEY, model: 'm', fetch: notJsonBody })).rejects.toThrow(AnalyzeError)
    expect(await db.meta.count()).toBe(0)
  })

  it('reads answers strictly', () => {
    expect(() => readAnswer(null)).toThrow(AnalyzeError)
    expect(() => readAnswer({ content: [{ type: 'thinking', thinking: '' }] })).toThrow(AnalyzeError)
    expect(() => readAnswer(answer([], { stop_reason: 'refusal' }))).toThrow('The AI declined this request. Nothing was changed.')
    expect(() => readAnswer(answer([], { stop_reason: 'max_tokens' }))).toThrow('The AI answer was cut off. Nothing was changed. Try again.')
    expect(readAnswer({ content: [{ type: 'thinking' }, { type: 'text', text: '{"rules":[]}' }] })).toEqual([])
    expect(() => parseRules({ rules: [null] })).toThrow(AnalyzeError)
    expect(() => parseRules({ rules: [{ match: 'contains', pattern: 1, owner: 'A', reason: '' }] })).toThrow(AnalyzeError)
    expect(() => parseRules({ rules: [{ match: 'contains', pattern: 'X', owner: 1, reason: '' }] })).toThrow(AnalyzeError)
    expect(() => parseRules({ rules: [{ match: 'contains', pattern: 'X', owner: 'A' }] })).toThrow(AnalyzeError)
  })

  it.each([
    [401, 'The API key was not accepted. Check it in Settings → AI.'],
    [403, 'The API key was not accepted. Check it in Settings → AI.'],
    [429, 'The AI is busy right now (rate limit). Try again in a minute.'],
    [529, 'The AI service is not available right now. Try again later.'],
    [400, 'The AI request failed (HTTP 400).'],
  ])('HTTP %i → readable error that never contains the key', async (status, message) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status }))
    const err = await analyzeLabels(input, { apiKey: KEY, model: 'm', fetch }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(AnalyzeError)
    expect((err as Error).message).toBe(message)
    expect((err as Error).message).not.toContain(KEY)
  })

  it('network failure → readable error; uses the global fetch when none is given', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(analyzeLabels(input, { apiKey: KEY, model: 'm', fetch })).rejects.toThrow('Could not reach the AI. Check your connection and try again.')
    const global = okFetch(answer([]))
    vi.stubGlobal('fetch', global)
    try {
      expect(await analyzeLabels(input, { apiKey: KEY, model: 'm' })).toEqual([])
      expect(global).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
