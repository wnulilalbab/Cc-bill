import { describe, expect, it } from 'vitest'
import { aiAnswerFor, expected } from '../../test/import/helpers'
import { AI_SCHEMA, AiResponseError, isoDate, jsonText, parseAiAnswer, rupiahOf, validateAiStatement } from './schema'

const row = (extra: Record<string, unknown> = {}) => ({ page: 0, date: '2026-10-02', postDate: '2026-10-03', description: 'GRAMEDIA MATRAMAN', amount: 245000, credit: false, ...extra })
const answer = (rows: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ statementDate: '2026-10-12', dueDate: '2026-10-28', totals: {}, rows, ...extra })

describe('AI answer: parse and repair', () => {
  it('accepts a recorded answer for every fixture unchanged', () => {
    for (const f of ['statements/bca-2026-10', 'statements/mandiri-2026-10', 'screenshots/mandiri-2026-09', 'unbilled/bca-unbilled-2026-10-10']) {
      const a = aiAnswerFor(expected(f))
      expect(parseAiAnswer(JSON.stringify(a))).toEqual(a)
    }
  })

  it('removes Markdown fences and prose around the JSON', () => {
    const text = 'Here you go:\n```json\n' + answer([row()]) + '\n```\nDone.'
    expect(parseAiAnswer(text).rows).toHaveLength(1)
    expect(jsonText('no json here')).toBe('no json here')
  })

  it('repairs amounts given as printed text, negative amounts, a missing booking date and page, and a bare list of rows', () => {
    const parsed = parseAiAnswer(
      JSON.stringify([
        { date: '2026-09-30', description: '  PAYMENT   THANK YOU ', amount: '-377,933.00' },
        { date: '2026-10-02T00:00:00Z', description: 'X', amount: 'Rp 9.000', credit: 'DB', page: -1 },
        { date: '2026-10-02', description: 'Y', amount: 1500.4, credit: 'CR' },
        { date: '2026-10-02', description: 'Z', amount: '44.631 CR' },
      ]),
    )
    expect(parsed.statementDate).toBeNull()
    expect(parsed.totals).toEqual({ prevBalance: null, credits: null, purchases: null, feesInterest: null, newBalance: null, minPayment: null })
    expect(parsed.rows).toEqual([
      { page: 0, date: '2026-09-30', postDate: '2026-09-30', description: 'PAYMENT THANK YOU', amount: 377933, credit: true },
      { page: 0, date: '2026-10-02', postDate: '2026-10-02', description: 'X', amount: 9000, credit: false },
      { page: 0, date: '2026-10-02', postDate: '2026-10-02', description: 'Y', amount: 1500, credit: true },
      { page: 0, date: '2026-10-02', postDate: '2026-10-02', description: 'Z', amount: 44631, credit: true },
    ])
  })

  it('reads printed totals as numbers or text', () => {
    const p = parseAiAnswer(answer([], { totals: { prevBalance: '5.846.117', newBalance: 3281096, minPayment: null } }))
    expect(p.totals).toMatchObject({ prevBalance: 5846117, newBalance: 3281096, credits: null, minPayment: null })
  })

  it('I-16 rejects answers it cannot trust, with a readable message', () => {
    const bad: [string, RegExp][] = [
      ['not json at all', /not valid JSON/],
      ['"just a string"', /not a statement/],
      [JSON.stringify({ rows: 'none' }), /no list of rows/],
      [answer(['row']), /Row 1 of the AI answer is not a row/],
      [answer([row({ date: '2026-02-30' })]), /no valid date \(got "2026-02-30"\)/],
      [answer([row({ date: undefined })]), /no valid date \(got null\)/],
      [answer([row({ description: '  ' })]), /has no description/],
      [answer([row({ amount: 'twelve' })]), /GRAMEDIA MATRAMAN\) has no readable amount/],
      [answer([row({ amount: null })]), /has no readable amount \(got null\)/],
      [answer([row({ amount: true })]), /has no readable amount/],
      [answer([row({ amount: Infinity })]), /has no readable amount/],
      [answer([row({ credit: 'maybe' })]), /does not say whether it is a credit/],
      [answer([row({ credit: 7 })]), /does not say whether it is a credit/],
      [answer([row({ credit: undefined, amount: { v: 1 } })]), /readable amount/],
      [answer([], { totals: { newBalance: 'lots' } }), /printed newBalance is not an amount/],
    ]
    for (const [text, message] of bad) {
      expect(() => parseAiAnswer(text), text).toThrow(AiResponseError)
      expect(() => parseAiAnswer(text), text).toThrow(message)
    }
  })

  it('validates already-parsed values (cache entries) the same way', () => {
    expect(() => validateAiStatement(null)).toThrow(AiResponseError)
    expect(validateAiStatement({ rows: [], totals: 'x' }).totals.newBalance).toBeNull()
  })

  it('isoDate and rupiahOf', () => {
    expect(isoDate('2026-10-12')).toBe('2026-10-12')
    expect(isoDate(20261012)).toBeNull()
    expect(isoDate('12-10-2026')).toBeNull()
    expect(rupiahOf('1.900.000')).toBe(1900000)
    expect(rupiahOf('1,900,000.00')).toBe(1900000)
    expect(rupiahOf('IDR 75,000')).toBe(75000)
    expect(rupiahOf('-Rp 320.000')).toBe(320000)
    expect(rupiahOf('1.2.3')).toBeNull()
    expect(rupiahOf(undefined)).toBeNull()
  })

  it('the output schema requires every field and allows no extra ones', () => {
    expect(AI_SCHEMA.additionalProperties).toBe(false)
    expect(AI_SCHEMA.properties.rows.items.required).toEqual(['page', 'date', 'postDate', 'description', 'amount', 'credit'])
    expect(AI_SCHEMA.properties.totals.required).toEqual(['prevBalance', 'credits', 'purchases', 'feesInterest', 'newBalance', 'minPayment'])
  })
})
