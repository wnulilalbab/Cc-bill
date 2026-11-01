import { describe, expect, it } from 'vitest'
import type { Card, Owner, Transaction } from '../types'
import { applyRule, previewRule, withManualOwner, withSuggestion } from './apply'
import { canonical, isMarketplace, normalizeMerchant, ruleKeyOf } from './merchant'
import { bySpecificity, describeMatch, evidenceText, pickRule, ruleEvidence, ruleMatches, ruleProblem, sameRule, vetProposals } from './rules'
import { suggestOwners } from './suggest'
import type { LabelledRow, TagRow, TagRule } from './types'

// Synthetic card "A" with owners Andi, Sari, Bima (archived), default Andi; card "B" with its own Andi.
const owners: Owner[] = [
  { id: 'a-andi', cardId: 'A', name: 'Andi' },
  { id: 'a-sari', cardId: 'A', name: 'Sari' },
  { id: 'a-bima', cardId: 'A', name: 'Bima', archived: true },
  { id: 'b-andi', cardId: 'B', name: 'Andi' },
]
const cardA: Card = { id: 'A', name: 'Card A', bank: 'BCA', defaultOwnerId: 'a-andi' }
const cardNone: Card = { ...cardA, defaultOwnerId: null }
const cardB: Card = { id: 'B', name: 'Card B', bank: 'Mandiri', defaultOwnerId: 'b-andi' }

const rule = (id: string, pattern: string, ownerId: string, extra: Partial<TagRule> = {}): TagRule => ({
  id, cardId: 'A', match: 'contains', pattern, ownerId, updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
})
const row = (description: string, extra: Partial<TagRow> = {}): TagRow => ({ description, kind: 'purchase', amount: 10000, date: '2026-10-10', ...extra })
const past = (description: string, ownerId: string | null, extra: Partial<LabelledRow> = {}): LabelledRow => ({
  description, kind: 'purchase', amount: 10000, date: '2026-09-01', ownerId, ...extra,
})
const one = (r: TagRow, history: LabelledRow[] = [], rules: TagRule[] = [], card = cardA, plans = undefined as Parameters<typeof suggestOwners>[3]['plans']) =>
  suggestOwners(card, [r], history, { owners, rules, plans })[0]

describe('merchant names', () => {
  it.each([
    ['GRAB* A-1JUL01AAAA JAKARTA PUSATID', 'GRAB'],
    ['Grab* A-2AUG01FFFF JAKARTA PUSAT IDN', 'GRAB'],
    ['OPENAI *CHATGPT SUBSCR SAN FRANCISCO USA', 'OPENAI CHATGPT SUBSCR'],
    ['Netflix.com Los Gatos SGP', 'NETFLIX'],
    ['RK BUAH GROSIR, CIPUTAT', 'RK BUAH GROSIR'],
    ['SHOPEE.CO.ID *AP1260721 JAKARTA BARATID', 'SHOPEE'],
    ['REFUND SHOPEE Jakarta SelatID', 'SHOPEE'],
    ['REVERSAL CICILAN BCA BLIBLI.COM *121', 'BLIBLI'],
    ['CICILAN BCA KE 01 DARI 06, BLIBLI.COM', 'BLIBLI'],
    ['UNIQLO AEON BSD 002/003', 'UNIQLO AEON BSD'],
    ['ROCKSTARGYM/30TH SEP 2026 JAKARTA UTARAID', 'ROCKSTARGYM'],
    ['TOKO 12/10/2026 REF 99812 BANDUNG', 'TOKO REF'],
    ['KIDZANIA JAKARTA', 'KIDZANIA'],
    ['JAKARTA', 'JAKARTA'],
    ['12345', '12345'],
    ['SAID ID', 'SAID'],
  ])('%s → %s', (line, merchant) => expect(normalizeMerchant(line)).toBe(merchant))

  it('canonical form is upper case with single spaces', () => expect(canonical('  a  b ')).toBe('A B'))

  it('T-02 marketplaces: Shopee, Tokopedia, Lazada, TikTok Shop (not Blibli, not "Blili")', () => {
    for (const d of ['SHOPEE.CO.ID *AP1', 'ShopeePay Jakarta', 'TOKOPEDIA JAKARTA', 'LAZADA ID', 'TIKTOK SHOP 123', 'tiktokshop']) expect(isMarketplace(d), d).toBe(true)
    for (const d of ['BLIBLI.COM *121', 'KOPI SOE BLILI MART', 'GRAB*']) expect(isMarketplace(d), d).toBe(false)
  })

  it('rule key: first two words of the merchant', () => {
    expect(ruleKeyOf('GRAB* A-1JUL01AAAA JAKARTA PUSATID')).toBe('GRAB')
    expect(ruleKeyOf('KOPI SOE BLILI MART')).toBe('KOPI SOE')
  })
})

describe('rules', () => {
  it('T-01 "starts with GRAB*" matches the raw line; contains matches the merchant name', () => {
    expect(ruleMatches({ match: 'startsWith', pattern: 'grab*' }, 'GRAB* A-1 JAKARTA')).toBe(true)
    expect(ruleMatches({ match: 'startsWith', pattern: 'GRAB*' }, 'PAY GRAB*')).toBe(false)
    expect(ruleMatches({ match: 'contains', pattern: 'netflix' }, 'Netflix.com Los Gatos SGP')).toBe(true)
    expect(ruleMatches({ match: 'contains', pattern: '  ' }, 'ANY')).toBe(false)
  })

  it('more specific first: longer, then starts-with, then newer, then id', () => {
    const r = [
      rule('b', 'GRAB', 'a-andi'),
      rule('a', 'GRAB', 'a-andi'),
      rule('c', 'GRAB', 'a-andi', { updatedAt: '2026-10-02T00:00:00.000Z' }),
      rule('d', 'GRAB', 'a-andi', { match: 'startsWith' }),
      rule('e', 'GRAB FOOD', 'a-andi'),
    ].sort(bySpecificity)
    expect(r.map((x) => x.id)).toEqual(['e', 'd', 'c', 'a', 'b'])
  })

  it('T-09 picks only rules of the card; reports conflicts and archived owners', () => {
    const usable = (id: string) => id !== 'a-bima'
    expect(pickRule([rule('x', 'GRAB', 'a-sari', { cardId: 'B' })], 'A', 'GRAB', usable)).toEqual({})
    const conflict = pickRule([rule('x', 'GRAB', 'a-sari'), rule('y', 'GRAB', 'a-andi', { updatedAt: '2026-10-05T00:00:00.000Z' })], 'A', 'GRAB', usable)
    expect(conflict.rule?.id).toBe('y')
    expect(conflict.conflict?.id).toBe('x')
    // A more specific rule that extends a general one wins silently.
    const specific = pickRule([rule('x', 'GRAB', 'a-sari'), rule('y', 'GRAB FOOD', 'a-andi')], 'A', 'GRAB FOOD', usable)
    expect([specific.rule?.id, specific.conflict]).toEqual(['y', undefined])
    expect(pickRule([rule('x', 'GRAB', 'a-sari'), rule('y', 'GRAB', 'a-andi', { match: 'startsWith' })], 'A', 'GRAB', usable).conflict).toBeUndefined()
    // Neither pattern contains the other: a real disagreement, whatever the lengths.
    const apart = pickRule([rule('x', 'NETFLIX', 'a-sari'), rule('y', 'SPOTIFY BUNDLE', 'a-andi')], 'A', 'NETFLIX SPOTIFY BUNDLE', usable)
    expect([apart.rule?.id, apart.conflict?.id]).toEqual(['y', 'x'])
    expect(pickRule([rule('x', 'GRAB', 'a-sari'), rule('y', 'GRAB', 'a-sari', { match: 'startsWith' })], 'A', 'GRAB', usable).conflict).toBeUndefined()
    expect(pickRule([rule('x', 'GRAB', 'a-bima')], 'A', 'GRAB', usable)).toEqual({ unusable: expect.objectContaining({ id: 'x' }) })
    expect(pickRule([rule('x', 'GRAB', 'a-bima'), rule('y', 'GRAB', 'a-sari')], 'A', 'GRAB', usable)).toEqual({ rule: expect.objectContaining({ id: 'y' }) })
  })

  it('validates drafts in plain English', () => {
    const d = { cardId: 'A', match: 'contains' as const, pattern: 'GRAB', ownerId: 'a-sari' }
    expect(ruleProblem(d, owners)).toBeNull()
    expect(ruleProblem({ ...d, match: 'equals' as never }, owners)).toBe('Pick "Starts with" or "Contains".')
    expect(ruleProblem({ ...d, pattern: ' g ' }, owners)).toBe('Type at least 2 letters of the merchant.')
    expect(ruleProblem({ ...d, ownerId: 'b-andi' }, owners)).toBe('Pick who this merchant belongs to.')
    expect(ruleProblem({ ...d, ownerId: 'a-bima' }, owners)).toBe('Bima is archived. Pick another owner.')
  })

  it('same rule ignores case and spaces; describes itself', () => {
    expect(sameRule(rule('x', 'grab  food', 'a'), rule('y', 'GRAB FOOD', 'b'))).toBe(true)
    expect(sameRule(rule('x', 'grab', 'a'), rule('y', 'grab', 'a', { cardId: 'B' }))).toBe(false)
    expect(describeMatch({ match: 'startsWith', pattern: 'grab*' })).toBe('Starts with GRAB*')
    expect(describeMatch({ match: 'contains', pattern: 'kci' })).toBe('Contains KCI')
  })

  it('evidence counts confirmed past rows of the card only', () => {
    const history = [past('GRAB 1', 'a-andi'), past('GRAB 2', 'a-andi'), past('GRAB 3', 'a-sari'), past('GRAB 4', 'a-sari', { check: true }), past('GRAB 5', null), past('GRAB 6', 'b-andi', { cardId: 'B' }), past('GRAB 7', 'a-andi', { cardId: 'A' })]
    const ev = ruleEvidence(rule('x', 'GRAB', 'a-andi'), history)
    expect(ev).toEqual({ agree: 3, total: 4 })
    expect(evidenceText(ev)).toBe('3 of 4 past rows agree')
    expect(evidenceText({ agree: 1, total: 1 })).toBe('1 of 1 past row agree')
  })
})

describe('T-08 vetting suggested rules', () => {
  const history = [past('GRAMEDIA A', 'a-sari'), past('GRAMEDIA B', 'a-sari'), past('GRAMEDIA C', 'a-andi'), past('KCI 1', 'a-andi'), past('KCI 2', 'a-andi'), past('HALO 1', 'a-sari'), past('HALO 2', 'a-andi'), past('SHOPEE X', 'a-sari'), past('SHOPEE Y', 'a-sari'), past('ONE 1', 'a-sari')]
  const ctx = { cardId: 'A', owners, rules: [rule('r', 'KCI', 'a-andi')], history }
  it('keeps majority-backed suggestions with evidence counted from history, best first', () => {
    const out = vetProposals(
      [
        { match: 'contains', pattern: 'gramedia', ownerId: 'a-sari', reason: 'Books' },
        { match: 'contains', pattern: 'KCI', ownerId: 'a-andi' }, // already a rule
        { match: 'contains', pattern: 'HALO', ownerId: 'a-sari' }, // 1 of 2: no majority
        { match: 'contains', pattern: 'SHOPEE', ownerId: 'a-sari' }, // marketplace
        { match: 'contains', pattern: 'ONE', ownerId: 'a-sari' }, // only 1 row
        { match: 'contains', pattern: 'X', ownerId: 'a-sari' }, // too short
        { match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-bima' }, // archived
        { match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-sari' }, // duplicate
        { match: 'startsWith', pattern: 'KCI', ownerId: 'a-andi' },
      ],
      ctx,
    )
    expect(out).toEqual([
      { cardId: 'A', match: 'contains', pattern: 'GRAMEDIA', ownerId: 'a-sari', reason: 'Books', agree: 2, total: 3 },
      { cardId: 'A', match: 'startsWith', pattern: 'KCI', ownerId: 'a-andi', agree: 2, total: 2 },
    ])
  })
  it('never suggests a dismissed rule again; same agree count sorts by pattern', () => {
    const proposals = [
      { match: 'contains' as const, pattern: 'KCI', ownerId: 'a-sari' },
      { match: 'contains' as const, pattern: 'GRAMEDIA', ownerId: 'a-sari' },
      { match: 'startsWith' as const, pattern: 'KCI', ownerId: 'a-andi' },
    ]
    expect(vetProposals(proposals, { ...ctx, rules: [], dismissed: [{ match: 'contains', pattern: 'gramedia', ownerId: 'a-sari' }] }).map((p) => p.pattern)).toEqual(['KCI'])
    expect(vetProposals(proposals.slice(1), { ...ctx, rules: [], dismissed: [{ match: 'contains', pattern: 'gramedia', ownerId: 'a-andi' }] }).map((p) => p.pattern)).toEqual(['GRAMEDIA', 'KCI'])
  })
})

describe('owner suggestions', () => {
  it('manual owner is kept as is, even on a marketplace row', () => {
    expect(one(row('SHOPEE 1', { manualOwnerId: 'a-sari' }))).toEqual({ ownerId: 'a-sari', check: false, source: 'manual', confidence: 1, reason: 'Set by you', marketplace: true })
  })

  it('T-01 rule → owner, source Rule, no Check', () => {
    expect(one(row('GRAB* A-1'), [], [rule('g', 'GRAB*', 'a-sari', { match: 'startsWith' })])).toMatchObject({ ownerId: 'a-sari', source: 'rule', check: false, ruleId: 'g' })
  })

  it('T-02 marketplace row with a matching rule: tagged, Check stays', () => {
    const s = one(row('SHOPEE.CO.ID *AP1'), [], [rule('s', 'SHOPEE', 'a-sari')])
    expect(s).toMatchObject({ ownerId: 'a-sari', source: 'rule', check: true, marketplace: true, confidence: 0.5 })
    expect(s.reason).toBe("Rule: Contains SHOPEE. Marketplace: the statement doesn't say who ordered")
  })

  it('conflicting rules: newest wins, Check on, both named', () => {
    const s = one(row('GRAB'), [], [rule('x', 'GRAB', 'a-sari'), rule('y', 'GRAB', 'a-andi', { updatedAt: '2026-10-09T00:00:00.000Z' })])
    expect(s).toMatchObject({ ownerId: 'a-andi', check: true, ruleId: 'y', reason: 'Rule: Contains GRAB. Rules disagree: "Contains GRAB" says Sari' })
    // "Starts with GRAB → Andi" + "Starts with GRABFOOD → Sari": a GRABFOOD row is Sari's, no Check; other GRAB rows stay Andi's.
    const grab = [rule('g', 'GRAB', 'a-andi', { match: 'startsWith' }), rule('f', 'GRABFOOD', 'a-sari', { match: 'startsWith' })]
    expect(one(row('GRABFOOD* A-1 JAKARTA PUSATID'), [], grab)).toMatchObject({ ownerId: 'a-sari', check: false, ruleId: 'f', reason: 'Rule: Starts with GRABFOOD' })
    expect(one(row('GRAB* A-2 JAKARTA PUSATID'), [], grab)).toMatchObject({ ownerId: 'a-andi', check: false, ruleId: 'g' })
    const apart = one(row('NETFLIX SPOTIFY BUNDLE'), [], [rule('x', 'NETFLIX', 'a-sari'), rule('y', 'SPOTIFY BUNDLE', 'a-andi')])
    expect(apart).toMatchObject({ ownerId: 'a-andi', check: true, reason: 'Rule: Contains SPOTIFY BUNDLE. Rules disagree: "Contains NETFLIX" says Sari' })
  })

  it('T-09 a rule of card A never applies on card B', () => {
    expect(one(row('GRAB'), [], [rule('x', 'GRAB', 'a-sari')], cardB)).toMatchObject({ ownerId: 'b-andi', source: 'default' })
  })

  it('archived owner: a rule pointing to them is ignored and the row asks for a check', () => {
    const s = one(row('GRAB'), [], [rule('x', 'GRAB', 'a-bima')])
    expect(s).toMatchObject({ ownerId: 'a-andi', check: true, source: 'default' })
    expect(s.reason).toBe('Card default owner. Rule "Contains GRAB" is for an archived owner')
    // ...even when weak history points to the default owner.
    expect(one(row('GRAB'), [past('GRAB', 'a-andi')], [rule('x', 'GRAB', 'a-bima')])).toMatchObject({ ownerId: 'a-andi', check: true, source: 'auto' })
  })

  it('archived owner: history, AI guesses and plans for them are not used', () => {
    const history = [past('KIDZ', 'a-bima'), past('KIDZ', 'a-bima')]
    expect(one(row('KIDZ', { aiGuess: { ownerId: 'a-bima', confidence: 0.95 } }), history)).toMatchObject({ ownerId: 'a-andi', source: 'default', check: false })
    expect(one(row('CICILAN KE 02 DARI 06, X', { kind: 'installment', planId: 'p' }), [], [], cardA, [{ id: 'p', cardId: 'A', ownerId: 'a-bima', name: 'X', monthly: 1, total: 6, start: '2026-09' }])).toMatchObject({ source: 'default' })
  })

  it('T-03 same merchant tagged the same way twice → Auto, no Check; once → that owner with Check', () => {
    expect(one(row('KIDZANIA JAKARTA'), [past('KIDZANIA JAKARTA', 'a-sari'), past('KIDZANIA', 'a-sari', { date: '2026-09-05' })])).toMatchObject({
      ownerId: 'a-sari', source: 'auto', check: false, confidence: 0.9, reason: 'Tagged Sari 2 of 2 times before',
    })
    expect(one(row('KIDZANIA'), [past('KIDZANIA', 'a-sari')])).toMatchObject({ ownerId: 'a-sari', source: 'auto', check: true, reason: 'Tagged Sari once before' })
    // Once before, as the card default: just the default, no Check.
    expect(one(row('NETFLIX.COM'), [past('NETFLIX.COM', 'a-andi')])).toMatchObject({ ownerId: 'a-andi', source: 'default', check: false })
  })

  it('history: most frequent owner wins; a tie goes to the most recent but asks for a check', () => {
    const h = [past('X', 'a-sari', { date: '2026-08-01' }), past('X', 'a-sari', { date: '2026-08-02' }), past('X', 'a-andi', { date: '2026-09-01' })]
    expect(one(row('X'), h)).toMatchObject({ ownerId: 'a-sari', check: false, reason: 'Tagged Sari 2 of 3 times before' })
    const tie = [past('X', 'a-sari', { date: '2026-08-01' }), past('X', 'a-sari', { date: '2026-07-01' }), past('X', 'a-andi', { date: '2026-09-01' }), past('X', 'a-andi', { date: '2026-08-15' })]
    expect(one(row('X'), tie)).toMatchObject({ ownerId: 'a-andi', check: true, reason: 'Past labels disagree' })
  })

  it('history counts only labels the user confirmed (by hand, or reviewed before tag sources), not default / rule / AI / auto tags', () => {
    const echo = (['default', 'rule', 'ai', 'auto', 'plan'] as const).flatMap((tagSource) => [past('X', 'a-sari', { tagSource }), past('X', 'a-sari', { tagSource })])
    expect(one(row('X'), echo)).toMatchObject({ source: 'default' })
    expect(one(row('X'), [past('X', 'a-sari', { tagSource: 'manual' }), past('X', 'a-sari')])).toMatchObject({ ownerId: 'a-sari', source: 'auto', check: false })
    expect(ruleEvidence(rule('r', 'X', 'a-sari'), echo)).toEqual({ agree: 0, total: 0 })
  })

  it('history ignores rows still waiting for a check, other cards, and other kinds', () => {
    const h = [past('X', 'a-sari', { check: true }), past('X', 'a-sari', { check: true }), past('X', 'b-andi', { cardId: 'B' }), past('X', 'a-sari', { kind: 'refund', amount: -1 })]
    expect(one(row('X'), h)).toMatchObject({ source: 'default', check: false })
  })

  it('T-04 AI guess: confident → AI without Check; low confidence → Check', () => {
    expect(one(row('NEW SHOP', { aiGuess: { ownerId: 'a-sari', confidence: 0.8 } }))).toMatchObject({ ownerId: 'a-sari', source: 'ai', check: false, confidence: 0.8 })
    expect(one(row('NEW SHOP', { aiGuess: { ownerId: 'a-sari', confidence: 0.3 } }))).toMatchObject({ ownerId: 'a-sari', source: 'ai', check: true, reason: 'AI guess, not sure' })
    expect(one(row('NEW SHOP', { aiGuess: { ownerId: null, confidence: 0.9 } }))).toMatchObject({ source: 'default' })
    // Weak history beats an unsure AI guess.
    expect(one(row('NEW SHOP', { aiGuess: { ownerId: 'a-andi', confidence: 0.3 } }), [past('NEW SHOP', 'a-sari')])).toMatchObject({ ownerId: 'a-sari', check: true })
  })

  it('T-05 / C-05 no match and card default None → no owner, Check', () => {
    expect(one(row('NEW SHOP'), [], [], cardNone)).toEqual({
      ownerId: null, check: true, source: 'default', confidence: 0, reason: 'No rule or history matches and the card has no default owner', marketplace: false,
    })
    expect(one(row('NEW SHOP'))).toMatchObject({ ownerId: 'a-andi', source: 'default', check: false, confidence: 0.6 })
  })

  it('M-07 fees and interest: card default without Check; a rule still wins; None → Check', () => {
    expect(one(row('BIAYA ADM KARTU', { kind: 'fee' }), [past('BIAYA ADM KARTU', 'a-sari'), past('BIAYA ADM KARTU', 'a-sari')])).toMatchObject({ ownerId: 'a-andi', source: 'default', check: false })
    expect(one(row('BUNGA', { kind: 'interest' }), [], [rule('b', 'BUNGA', 'a-sari')])).toMatchObject({ ownerId: 'a-sari', source: 'rule' })
    expect(one(row('BUNGA', { kind: 'interest' }), [], [], cardNone)).toMatchObject({ ownerId: null, check: true })
  })

  it('refund follows the purchase (merchant + exact amount) in the same batch, including its Check; else a past purchase', () => {
    const rows = [
      row('TOKO A', { amount: 500, date: '2026-10-01', aiGuess: { ownerId: 'a-sari', confidence: 0.3 } }),
      row('TOKO A', { amount: 700, date: '2026-10-02', aiGuess: { ownerId: 'a-sari', confidence: 0.3 } }),
      row('REFUND TOKO A', { kind: 'refund', amount: -700, date: '2026-10-05' }),
    ]
    const out = suggestOwners(cardA, rows, [], { owners, rules: [] })
    expect(out[2]).toMatchObject({ ownerId: 'a-sari', check: true, follows: 1, source: 'auto', reason: 'Same owner as the refunded purchase', marketplace: false })
    const reviewed = suggestOwners(cardA, [rows[0], { ...rows[1], manualOwnerId: 'a-andi' }, rows[2]], [], { owners, rules: [] })
    expect(reviewed[2]).toMatchObject({ ownerId: 'a-andi', check: false, follows: 1 })
    expect(one(row('REFUND TOKO A', { kind: 'refund', amount: -700 }), [past('TOKO A', 'a-sari', { amount: 700 }), past('TOKO A', 'a-andi', { amount: 500 })])).toMatchObject({
      ownerId: 'a-sari', check: false, confidence: 0.9,
    })
  })

  it('marketplace refunds keep their own Check even when they follow a confirmed purchase', () => {
    const rows = [row('SHOPEE A', { amount: 700, date: '2026-10-02', manualOwnerId: 'a-sari' }), row('REFUND SHOPEE A', { kind: 'refund', amount: -700, date: '2026-10-05' })]
    const s = suggestOwners(cardA, rows, [], { owners, rules: [] })[1]
    expect(s).toMatchObject({ ownerId: 'a-sari', check: true, follows: 0, marketplace: true, confidence: 0.5 })
    expect(s.reason).toBe("Same owner as the refunded purchase. Marketplace: the statement doesn't say who ordered")
    expect(one(row('REFUND SHOPEE A', { kind: 'refund', amount: -700 }), [past('SHOPEE A', 'a-sari', { amount: 700 })])).toMatchObject({ ownerId: 'a-sari', check: true })
  })

  it('refund: never follows a later purchase, nor one with another amount; none → normal tagging', () => {
    const rows = [row('REFUND X', { kind: 'refund', amount: -500, date: '2026-10-01' }), row('X', { amount: 500, date: '2026-10-03', manualOwnerId: 'a-sari' })]
    expect(suggestOwners(cardA, rows, [], { owners, rules: [] })[0]).toMatchObject({ ownerId: 'a-andi', source: 'default' })
    const other = one(row('REFUND X', { kind: 'refund', amount: -499 }), [past('X', 'a-sari', { amount: 500 })])
    expect(other).toMatchObject({ reason: 'Tagged Sari once before', check: true })
    expect(other.follows).toBeUndefined()
    expect(one(row('REFUND TOKOPEDIA', { kind: 'refund', amount: -1 }))).toMatchObject({ source: 'default', check: true, marketplace: true })
  })

  it('reversal follows the purchase it cancels (by description, or by merchant and amount)', () => {
    const h = [past('BLIBLI.COM *121 SEPEDA STATIS', 'a-sari', { amount: 4376200 })]
    expect(one(row('REVERSAL CICILAN BCA BLIBLI.COM *121', { kind: 'reversal', amount: -4376200, reverses: 'BLIBLI.COM *121 SEPEDA STATIS' }), h)).toMatchObject({ ownerId: 'a-sari', reason: 'Same owner as the purchase it cancels' })
    expect(one(row('REVERSAL CICILAN BCA BLIBLI.COM *121', { kind: 'reversal', amount: -9 }), [past('BLIBLI', 'a-sari', { amount: 9 })])).toMatchObject({ ownerId: 'a-sari' })
    expect(one(row('REVERSAL X', { kind: 'reversal', amount: -9 }))).toMatchObject({ source: 'default' })
  })

  it('installment 1/N follows the reversal in the same statement; a past reversal does not start a plan', () => {
    const rows = [
      row('CICILAN BCA KE 01 DARI 06, BLIBLI.COM', { kind: 'installment', installment: { n: 1, of: 6 }, amount: 729367 }),
      row('REVERSAL CICILAN BCA BLIBLI.COM *121', { kind: 'reversal', amount: -4376200, reverses: 'BLIBLI.COM *121 SEPEDA STATIS' }),
    ]
    const out = suggestOwners(cardA, rows, [past('BLIBLI.COM *121 SEPEDA STATIS', 'a-sari', { amount: 4376200 })], { owners, rules: [] })
    expect(out[0]).toMatchObject({ ownerId: 'a-sari', source: 'plan', follows: 1, check: false })
    expect(one(rows[0], [past('REVERSAL CICILAN BCA BLIBLI.COM *121', 'a-sari', { kind: 'reversal', amount: -4376200 })])).toMatchObject({ source: 'default' })
  })

  it('installments: plan owner first, else the earlier installments', () => {
    const plans = [{ id: 'p', cardId: 'A', ownerId: 'a-sari', name: 'Sepeda', monthly: 1, total: 6, start: '2026-10' }]
    const inst = row('CICILAN BCA KE 02 DARI 06, BLIBLI.COM', { kind: 'installment', installment: { n: 2, of: 6 }, planId: 'p' })
    expect(one(inst, [], [], cardA, plans)).toMatchObject({ ownerId: 'a-sari', source: 'plan', reason: 'Installment plan "Sepeda"' })
    expect(one({ ...inst, planId: 'other' }, [], [], cardA, plans)).toMatchObject({ source: 'default' })
    expect(one({ ...inst, planId: undefined }, [past('CICILAN BCA KE 01 DARI 06, BLIBLI.COM', 'a-sari', { kind: 'installment' })])).toMatchObject({
      ownerId: 'a-sari', source: 'plan', reason: 'Same owner as the earlier installments',
    })
    expect(one({ ...inst, planId: 'p' }, [], [rule('r', 'BLIBLI', 'a-andi')])).toMatchObject({ source: 'rule' })
  })

  it('every row gets an answer, in order', () => {
    const out = suggestOwners(cardA, [row('A'), row('B', { manualOwnerId: null })], [], { owners, rules: [] })
    expect(out.map((s) => s.source)).toEqual(['default', 'manual'])
  })
})

describe('applying tags to stored rows', () => {
  const tx = (id: string, description: string, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
    id, cardId: 'A', statementId: 's', date: '2026-10-01', description, amount: 1000, kind: 'purchase', ownerId, ...extra,
  })

  it('a suggestion sets owner, source and Check; a manual owner clears Check', () => {
    const t = tx('t', 'X', null, { check: true })
    expect(withSuggestion(t, { ownerId: 'a-sari', check: false, source: 'rule', confidence: 1, reason: '', marketplace: false })).toEqual({ ...tx('t', 'X', 'a-sari'), tagSource: 'rule' })
    expect(withSuggestion(tx('t', 'X', null), { ownerId: null, check: true, source: 'default', confidence: 0, reason: '', marketplace: false })).toMatchObject({ check: true, tagSource: 'default' })
    expect(withManualOwner(t, 'a-andi')).toEqual({ ...tx('t', 'X', 'a-andi'), tagSource: 'manual' })
  })

  it('T-06 preview: only Check or unowned rows change by default; owned rows only on opt-in; manual and paid rows never; other cards never', () => {
    const r = rule('r', 'GRAB', 'a-sari')
    const rows = [
      tx('check', 'GRAB 1', 'a-andi', { check: true }),
      tx('none', 'GRAB 2', null),
      tx('same', 'GRAB 3', 'a-sari'),
      tx('owned', 'GRAB 4', 'a-andi', { tagSource: 'auto' }),
      tx('mine', 'GRAB 5', 'a-andi', { tagSource: 'manual' }),
      tx('other', 'NETFLIX', null),
      tx('cardB', 'GRAB 6', null, { cardId: 'B' }),
      tx('self', 'GRAB 7', null),
      tx('mineNone', 'GRAB 8', null, { tagSource: 'manual' }),
      tx('mineSame', 'GRAB 9', 'a-sari', { tagSource: 'manual' }),
      tx('paid', 'GRAB 10', null),
      tx('paidOwned', 'GRAB 11', 'a-andi'),
    ]
    const p = previewRule(r, rows, 'self', new Set(['paid', 'paidOwned', 'same']))
    expect(p.unsure.map((t) => t.id)).toEqual(['check', 'none'])
    expect(p.owned.map((t) => t.id)).toEqual(['owned'])
    expect(p.manual).toBe(2)
    expect(p.paid).toBe(2)
    expect(applyRule(r, p)).toEqual([
      { ...rows[0], ownerId: 'a-sari', tagSource: 'rule', check: undefined },
      { ...rows[1], ownerId: 'a-sari', tagSource: 'rule' },
    ].map(({ check: _c, ...t }) => t))
    expect(applyRule(r, p, { includeOwned: true }).map((t) => t.id)).toEqual(['check', 'none', 'owned'])
    expect(previewRule(r, rows, 'self')).toMatchObject({ manual: 2, paid: 0 })
  })

  it('T-02 marketplace rows: the rule sets the owner but Check stays; already that owner → unchanged', () => {
    const r = rule('r', 'SHOPEE', 'a-sari')
    const p = previewRule(r, [tx('a', 'SHOPEE 1', 'a-andi', { check: true }), tx('b', 'SHOPEE 2', 'a-sari', { check: true })])
    expect(p.unsure.map((t) => t.id)).toEqual(['a'])
    expect(applyRule(r, p)[0]).toMatchObject({ ownerId: 'a-sari', check: true, tagSource: 'rule' })
    const credits = previewRule(r, [tx('c', 'REFUND SHOPEE 1', null, { kind: 'refund', amount: -5 }), tx('d', 'CICILAN KE 01 DARI 03, SHOPEE', null, { kind: 'installment' })])
    expect(applyRule(r, credits).map((t) => t.check)).toEqual([true, undefined])
  })
})
