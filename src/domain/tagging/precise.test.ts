// Exact behaviour at the edges (boundaries, every list entry, exact reasons and confidences), so that mutation
// testing can tell a change apart. Synthetic data only.
import { describe, expect, it } from 'vitest'
import type { Card, Owner } from '../types'
import { CITIES, COUNTRIES, GLUE_BASES, MONTHS, normalizeMerchant } from './merchant'
import { bySpecificity, pickRule, ruleProblem, vetProposals } from './rules'
import { suggestOwners } from './suggest'
import type { LabelledRow, TagRow, TagRule } from './types'

const owners: Owner[] = [
  { id: 'a-andi', cardId: 'A', name: 'Andi' },
  { id: 'a-sari', cardId: 'A', name: 'Sari' },
  { id: 'a-bima', cardId: 'A', name: 'Bima', archived: true },
  { id: 'b-andi', cardId: 'B', name: 'Andi' },
]
const cardA: Card = { id: 'A', name: 'Card A', bank: 'BCA', defaultOwnerId: 'a-andi' }
const rule = (id: string, pattern: string, ownerId: string, extra: Partial<TagRule> = {}): TagRule => ({
  id, cardId: 'A', match: 'contains', pattern, ownerId, updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
})
const row = (description: string, extra: Partial<TagRow> = {}): TagRow => ({ description, kind: 'purchase', amount: 10000, date: '2026-10-10', ...extra })
const past = (description: string, ownerId: string | null, extra: Partial<LabelledRow> = {}): LabelledRow => ({
  description, kind: 'purchase', amount: 10000, date: '2026-09-01', ownerId, ...extra,
})
const run = (rows: TagRow[], history: LabelledRow[] = [], rules: TagRule[] = [], plans?: Parameters<typeof suggestOwners>[3]['plans']) =>
  suggestOwners(cardA, rows, history, { owners, rules, plans })
const one = (r: TagRow, history: LabelledRow[] = [], rules: TagRule[] = [], plans?: Parameters<typeof suggestOwners>[3]['plans']) => run([r], history, rules, plans)[0]

describe('merchant names: every list entry and boundary', () => {
  it('lists hold exactly these entries', () => {
    expect([...MONTHS]).toEqual(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'MEI', 'JUN', 'JUL', 'AUG', 'AGU', 'AGS', 'SEP', 'OCT', 'OKT', 'NOV', 'DEC', 'DES'])
    expect([...COUNTRIES]).toEqual(['ID', 'IDN', 'USA', 'US', 'SGP', 'SG', 'IRL', 'NLD', 'GBR', 'AUS', 'MYS'])
    expect(CITIES.map((c) => c.join(' '))).toEqual([
      'JAKARTA PUSAT', 'JAKARTA SELATAN', 'JAKARTA SELAT', 'JAKARTA BARAT', 'JAKARTA TIMUR', 'JAKARTA UTARA', 'TANGERANG SELATAN',
      'SAN FRANCISCO', 'LOS GATOS', 'JAKARTA', 'BANDUNG', 'SURABAYA', 'TANGERANG', 'BEKASI', 'DEPOK', 'BOGOR', 'CIPUTAT', 'DENPASAR',
      'MEDAN', 'YOGYAKARTA', 'SEMARANG', 'SINGAPORE', 'DUBLIN', 'AMSTERDAM',
    ])
    expect([...GLUE_BASES]).toEqual([
      'PUSAT', 'SELATAN', 'SELAT', 'BARAT', 'TIMUR', 'UTARA', 'JAKARTA', 'BANDUNG', 'SURABAYA', 'TANGERANG', 'BEKASI', 'DEPOK', 'BOGOR', 'CIPUTAT',
      'DENPASAR', 'MEDAN', 'YOGYAKARTA', 'SEMARANG', 'SINGAPORE', 'DUBLIN', 'AMSTERDAM',
    ])
  })

  it.each([...MONTHS])('month %s is dropped anywhere', (m) => expect(normalizeMerchant(`TOKO ${m} BARU`)).toBe('TOKO BARU'))
  it.each([...COUNTRIES])('country %s is dropped at the end only', (c) => {
    expect(normalizeMerchant(`TOKO ${c}`)).toBe('TOKO')
    expect(normalizeMerchant(`${c} TOKO`)).toBe(`${c} TOKO`)
  })
  it.each(CITIES.map((c) => c.join(' ')))('city %s is dropped at the end only', (city) => {
    expect(normalizeMerchant(`TOKO ${city}`)).toBe('TOKO')
    expect(normalizeMerchant(`${city} TOKO`)).toBe(`${city} TOKO`)
  })
  it.each([...GLUE_BASES])('a country code glued to %s is unglued', (b) => {
    // A single-word city goes entirely; a district (PUSAT…) stays unless its city is in front of it.
    const want = CITIES.some((c) => c.length === 1 && c[0] === b) ? 'TOKO' : `TOKO ${b}`
    expect(normalizeMerchant(`TOKO ${b}ID`)).toBe(want)
    expect(normalizeMerchant(`TOKO ${b}IDN`)).toBe(want)
  })

  it('ungluing: only a known base, only the whole word, only at its end', () => {
    expect(normalizeMerchant('TOKO SANID')).toBe('TOKO SANID') // first word of a two-word city is not a base
    expect(normalizeMerchant('TOKO LOSID')).toBe('TOKO LOSID')
    expect(normalizeMerchant('TOKO SAID')).toBe('TOKO SAID')
    expect(normalizeMerchant('TOKO A-PUSATID')).toBe('TOKO A-PUSATID')
    expect(normalizeMerchant('TOKO PUSATIDX')).toBe('TOKO PUSATIDX')
    expect(normalizeMerchant('TOKO PUSATIDN')).toBe('TOKO PUSAT')
    expect(normalizeMerchant('TOKO JAKARTA SELATANID')).toBe('TOKO')
  })

  it('cities: every word must match, never the whole name, and several in a row go', () => {
    expect(normalizeMerchant('TOKO SAN JOSE')).toBe('TOKO SAN JOSE')
    expect(normalizeMerchant('TOKO FRANCISCO')).toBe('TOKO FRANCISCO')
    expect(normalizeMerchant('JAKARTA PUSAT 123')).toBe('JAKARTA PUSAT')
    expect(normalizeMerchant('TOKO BANDUNG JAKARTA')).toBe('TOKO')
    expect(normalizeMerchant('TOKO JAKARTA USA')).toBe('TOKO')
    expect(normalizeMerchant('TOKO USA JAKARTA')).toBe('TOKO')
  })

  it('a single word is never shortened', () => {
    expect(normalizeMerchant('PUSATID')).toBe('PUSATID')
    expect(normalizeMerchant('USA')).toBe('USA')
    expect(normalizeMerchant('')).toBe('')
  })

  it('prefixes: only at the start, with or without BCA and the comma, repeated', () => {
    expect(normalizeMerchant('REVERSAL CICILAN BLIBLI.COM')).toBe('BLIBLI')
    expect(normalizeMerchant('REVERSAL CICILAN BCA BLIBLI.COM')).toBe('BLIBLI')
    expect(normalizeMerchant('CICILAN KE 02 DARI 03, UNIQLO')).toBe('UNIQLO')
    expect(normalizeMerchant('CICILAN BCA KE 02 DARI 06 BLIBLI.COM')).toBe('BLIBLI')
    expect(normalizeMerchant('TOKO REFUND CENTER')).toBe('TOKO REFUND CENTER')
    expect(normalizeMerchant('REFUND  PEMBATALAN SHOPEE')).toBe('SHOPEE')
    expect(normalizeMerchant('REFUNDS TOKO')).toBe('REFUNDS TOKO')
  })
})

describe('rules: exact ordering and limits', () => {
  it('starts-with beats contains even when older; a 2-letter pattern is enough', () => {
    const older = rule('s', 'GRAB', 'a-andi', { match: 'startsWith', updatedAt: '2026-01-01T00:00:00.000Z' })
    const newer = rule('c', 'GRAB', 'a-andi', { updatedAt: '2026-12-01T00:00:00.000Z' })
    expect(bySpecificity(older, newer)).toBeLessThan(0)
    expect(bySpecificity(newer, older)).toBeGreaterThan(0)
    expect(ruleProblem({ cardId: 'A', match: 'contains', pattern: 'KC', ownerId: 'a-andi' }, owners)).toBeNull()
  })

  it('disjoint rules for the same owner are no conflict', () => {
    const p = pickRule([rule('x', 'NETFLIX', 'a-sari'), rule('y', 'SPOTIFY BUNDLE', 'a-sari')], 'A', 'NETFLIX SPOTIFY BUNDLE', (id) => id !== 'a-bima')
    expect(p).toEqual({ rule: expect.objectContaining({ id: 'y' }) })
  })

  it('vetting: invalid drafts are dropped even with evidence; exactly half is not a majority; best evidence first', () => {
    const history = [past('KCI 1', 'a-andi'), past('KCI 2', 'a-andi'), ...['ZETA 1', 'ZETA 2', 'ZETA 3'].map((d) => past(d, 'a-sari')), past('ALPHA 1', 'a-andi'), past('ALPHA 2', 'a-andi')]
    const half = [past('HALF 1', 'a-sari'), past('HALF 2', 'a-sari'), past('HALF 3', 'a-andi'), past('HALF 4', 'a-andi')]
    const ctx = { cardId: 'A', owners, rules: [], history: [...history, ...half] }
    const out = vetProposals(
      [
        { match: 'contains', pattern: 'K', ownerId: 'a-andi' },
        { match: 'contains', pattern: 'HALF', ownerId: 'a-sari' },
        { match: 'contains', pattern: 'ALPHA', ownerId: 'a-andi' },
        { match: 'contains', pattern: 'ZETA', ownerId: 'a-sari' },
      ],
      ctx,
    )
    expect(out.map((p) => [p.pattern, p.agree, p.total])).toEqual([
      ['ZETA', 3, 3],
      ['ALPHA', 2, 2],
    ])
  })
})

describe('suggestions: exact sources, reasons and confidences', () => {
  it('owners of another card or unknown ids are never used', () => {
    expect(one(row('NEW', { aiGuess: { ownerId: 'b-andi', confidence: 0.95 } }))).toMatchObject({ ownerId: 'a-andi', source: 'default' })
    expect(one(row('NEW', { aiGuess: { ownerId: 'nobody', confidence: 0.95 } }))).toMatchObject({ ownerId: 'a-andi', source: 'default' })
  })

  it('AI guess exactly at the threshold is confident', () => {
    expect(one(row('NEW', { aiGuess: { ownerId: 'a-sari', confidence: 0.7 } }))).toEqual({ ownerId: 'a-sari', check: false, source: 'ai', confidence: 0.7, reason: 'AI guess', marketplace: false })
    expect(one(row('NEW', { aiGuess: { ownerId: 'a-sari', confidence: 0.69 } }))).toMatchObject({ check: true, confidence: 0.69 })
  })

  it('history: confidence is the share of agreeing labels; ties go to the owner with the newest label', () => {
    const h = [past('X', 'a-sari'), past('X', 'a-sari'), past('X', 'a-andi')]
    expect(one(row('X'), h)).toEqual({ ownerId: 'a-sari', check: false, source: 'auto', confidence: 2 / 3, reason: 'Tagged Sari 2 of 3 times before', marketplace: false })
    // Newest Sari label is the last in the list, newest Andi label the first.
    const tie = [past('X', 'a-andi', { date: '2026-08-10' }), past('X', 'a-sari', { date: '2026-07-01' }), past('X', 'a-andi', { date: '2026-06-01' }), past('X', 'a-sari', { date: '2026-08-20' })]
    expect(one(row('X'), tie)).toEqual({ ownerId: 'a-sari', check: true, source: 'auto', confidence: 0.4, reason: 'Past labels disagree', marketplace: false })
  })

  it('interest with learned history still goes to the card default', () => {
    expect(one(row('BUNGA', { kind: 'interest' }), [past('BUNGA', 'a-sari'), past('BUNGA', 'a-sari')])).toEqual({
      ownerId: 'a-andi', check: false, source: 'default', confidence: 0.6, reason: 'Card default owner', marketplace: false,
    })
  })

  it('only purchases and refunds are marketplace rows', () => {
    expect(one(row('CICILAN KE 02 DARI 03, SHOPEE', { kind: 'installment', installment: { n: 2, of: 3 } }))).toMatchObject({ marketplace: false, check: false })
    expect(one(row('BIAYA SHOPEE', { kind: 'fee' }))).toMatchObject({ marketplace: false, check: false })
  })

  it('conflict suggestion: source Rule, confidence 0.5', () => {
    expect(one(row('NETFLIX SPOTIFY BUNDLE'), [], [rule('x', 'NETFLIX', 'a-sari'), rule('y', 'SPOTIFY BUNDLE', 'a-andi')])).toMatchObject({ source: 'rule', confidence: 0.5, check: true })
  })

  it('archived-owner rule note caps confidence at 0.5', () => {
    expect(one(row('GRAB'), [], [rule('x', 'GRAB', 'a-bima')])).toMatchObject({ confidence: 0.5, check: true })
  })

  it('plans and earlier installments only decide installments', () => {
    const plans = [{ id: 'p', cardId: 'A', ownerId: 'a-sari', name: 'X', monthly: 1, total: 3, start: '2026-09' }]
    expect(one(row('TOKO X', { planId: 'p' }), [], [], plans)).toMatchObject({ source: 'default' })
    expect(one(row('UNIQLO'), [past('CICILAN KE 01 DARI 03, UNIQLO', 'a-sari', { kind: 'installment' })])).toMatchObject({ source: 'default' })
  })

  it('refunds: follow a charge of the same merchant and amount (installments too), newest first; never another merchant', () => {
    const inst = row('CICILAN BCA KE 02 DARI 06, BLIBLI.COM', { kind: 'installment', installment: { n: 2, of: 6 }, amount: 700, date: '2026-10-01', manualOwnerId: 'a-sari' })
    expect(run([inst, row('REFUND BLIBLI.COM', { kind: 'refund', amount: -700 })])[1]).toEqual({
      ownerId: 'a-sari', check: false, source: 'auto', confidence: 1, reason: 'Same owner as the refunded purchase', follows: 0, marketplace: false,
    })
    expect(run([row('OTHER', { amount: 700, date: '2026-10-01', manualOwnerId: 'a-sari' }), row('REFUND TOKO', { kind: 'refund', amount: -700 })])[1]).toMatchObject({ source: 'default' })
    // Two past purchases of the same amount: the newest one decides, wherever it is in the list.
    const h = [past('TOKO', 'a-sari', { amount: 700, date: '2026-08-01' }), past('TOKO', 'a-andi', { amount: 700, date: '2026-09-01' }), past('TOKO', 'a-sari', { amount: 700, date: '2026-07-01' })]
    expect(one(row('REFUND TOKO', { kind: 'refund', amount: -700 }), h)).toMatchObject({ ownerId: 'a-andi' })
    // In a batch, the newest earlier purchase decides.
    const batch = run([
      row('TOKO', { amount: 700, date: '2026-10-01', manualOwnerId: 'a-sari' }),
      row('TOKO', { amount: 700, date: '2026-10-03', manualOwnerId: 'a-andi' }),
      row('TOKO', { amount: 700, date: '2026-10-02', manualOwnerId: 'a-sari' }),
      row('REFUND TOKO', { kind: 'refund', amount: -700, date: '2026-10-05' }),
    ])
    expect(batch[3]).toMatchObject({ ownerId: 'a-andi', follows: 1 })
  })

  it('reversals without a description of the purchase: same merchant and same amount, nothing else', () => {
    const rev = row('REVERSAL CICILAN BCA TOKO', { kind: 'reversal', amount: -900 })
    expect(one(rev, [past('TOKO', 'a-sari', { amount: 900 })])).toEqual({ ownerId: 'a-sari', check: false, source: 'auto', confidence: 0.9, reason: 'Same owner as the purchase it cancels', marketplace: false })
    expect(one(rev, [past('TOKO', 'a-sari', { amount: 901 })]).reason).not.toBe('Same owner as the purchase it cancels')
    expect(one(rev, [past('OTHER', 'a-sari', { amount: 900 })])).toMatchObject({ source: 'default' })
    // With the description, the amount doesn't matter (the reversal may carry fees), the merchant does.
    expect(one({ ...rev, reverses: 'TOKO BESAR' }, [past('TOKO BESAR', 'a-sari', { amount: 5 })])).toMatchObject({ ownerId: 'a-sari', reason: 'Same owner as the purchase it cancels' })
    expect(one({ ...rev, reverses: 'TOKO BESAR' }, [past('TOKO', 'a-sari', { amount: 900 })]).reason).toBe('Tagged Sari once before')
  })

  it('only installment 1/N follows a reversal, of the same merchant', () => {
    const rev = row('REVERSAL CICILAN BCA TOKO', { kind: 'reversal', amount: -900, manualOwnerId: 'a-sari' })
    const first = row('CICILAN BCA KE 01 DARI 03, TOKO', { kind: 'installment', installment: { n: 1, of: 3 }, amount: 300 })
    expect(run([rev, first])[1]).toEqual({ ownerId: 'a-sari', check: false, source: 'plan', confidence: 1, reason: 'Same owner as the purchase moved to installment', follows: 0, marketplace: false })
    expect(run([rev, { ...first, installment: { n: 2, of: 3 } }])[1]).toMatchObject({ source: 'default' })
    expect(run([rev, { ...first, installment: undefined }])[1]).toMatchObject({ source: 'default' })
    expect(run([rev, { ...first, description: 'CICILAN BCA KE 01 DARI 03, LAIN' }])[1]).toMatchObject({ source: 'default' })
    expect(run([rev, row('TOKO', { installment: { n: 1, of: 3 } })])[1]).toMatchObject({ source: 'default' })
  })
})
