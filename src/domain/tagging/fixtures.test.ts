// Fixture-driven: replays the synthetic household's statements in order, as the user would import and review them.
import { describe, expect, it } from 'vitest'
import { normalizeMerchant } from './merchant'
import { suggestOwners } from './suggest'
import type { LabelledRow, TagRow } from './types'
import { aiGuesses, cards, kindOf, ownerId, owners, rules, statements, taggable, type CardKey, type ExpectedRow } from '../../../test/tagging/household'

function toRow(card: CardKey, r: ExpectedRow): TagRow {
  const guess = aiGuesses[card][normalizeMerchant(r.description)]
  return {
    description: r.description,
    kind: kindOf(r),
    amount: r.amount,
    date: r.txDate,
    ...(r.reverses && { reverses: r.reverses }),
    ...(r.installment && { installment: { n: r.installment.n, of: r.installment.of } }),
    ...(guess && { aiGuess: { ownerId: ownerId(card, guess), confidence: 0.9 } }),
  }
}

describe.each(['bca', 'mandiri'] as const)('tagging the synthetic %s statements in order', (card) => {
  it('T-03 T-01 T-02 every row is right or carries Check; after reviewing only the Check rows, every owner matches the expected file', () => {
    const history: LabelledRow[] = []
    let checks = 0
    for (const st of statements[card]) {
      const lines = st.rows.filter(taggable)
      const rows = lines.map((r) => toRow(card, r))
      const first = suggestOwners(cards[card], rows, history, { owners, rules })
      lines.forEach((line, i) => {
        const want = line.expectedOwner && ownerId(card, line.expectedOwner)
        const s = first[i]
        const where = `${st.file}: ${line.description} ${line.amount}`
        // Marketplace lines (needsCheck) always ask; anything shown without Check must already be right.
        if (line.needsCheck) expect(s.check, where).toBe(true)
        if (!s.check) expect(s.ownerId, where).toBe(want)
      })
      checks += first.filter((s) => s.check).length

      // The user reviews the Check rows (sets the expected owner), then auto-tag re-runs for the rest.
      const reviewed = rows.map((r, i) => (first[i].check ? { ...r, manualOwnerId: ownerId(card, lines[i].expectedOwner!) } : r))
      const second = suggestOwners(cards[card], reviewed, history, { owners, rules })
      lines.forEach((line, i) => {
        expect(second[i].ownerId, `${st.file}: ${line.description}`).toBe(ownerId(card, line.expectedOwner!))
        expect(second[i].check).toBe(false)
      })
      history.push(...lines.map((l, i) => ({ description: l.description, kind: kindOf(l), amount: l.amount, date: l.txDate, ownerId: second[i].ownerId, cardId: card })))
    }
    // Check rows are the marketplace lines plus the refunds that follow them (settled by the same review).
    const marketplaceLines = statements[card].flatMap((s) => s.rows).filter((r) => r.needsCheck).length
    expect(checks).toBeGreaterThanOrEqual(marketplaceLines)
    expect(checks).toBeLessThanOrEqual(marketplaceLines + 2)
  })
})

describe('sources on the household fixtures', () => {
  const bca = statements.bca
  const run = (upTo: number) => {
    const history: LabelledRow[] = bca.slice(0, upTo).flatMap((s) =>
      s.rows.filter(taggable).map((l) => ({ description: l.description, kind: kindOf(l), amount: l.amount, date: l.txDate, ownerId: ownerId('bca', l.expectedOwner!), cardId: 'bca' })),
    )
    const lines = bca[upTo].rows.filter(taggable)
    return { lines, out: suggestOwners(cards.bca, lines.map((l) => toRow('bca', l)), history, { owners, rules }) }
  }
  const find = (r: ReturnType<typeof run>, description: string) => r.out[r.lines.findIndex((l) => l.description === description)]

  it('T-01 GRAB* lines come from the rule, source Rule, no Check', () => {
    const s = find(run(0), 'GRAB* A-1JUL01AAAA JAKARTA PUSATID')
    expect(s).toMatchObject({ ownerId: 'bca-andi', source: 'rule', check: false, ruleId: 'r-grab', reason: 'Rule: Starts with GRAB*' })
  })

  it('T-03 NETFLIX tagged Keluarga twice before → source Auto, no Check', () => {
    expect(find(run(2), 'NETFLIX.COM')).toMatchObject({ ownerId: 'bca-keluarga', source: 'auto', check: false, reason: 'Tagged Keluarga 2 of 2 times before' })
  })

  it('M-07 fees and interest go to the card default owner without Check', () => {
    const r = run(3)
    expect(find(r, 'BUNGA')).toMatchObject({ ownerId: 'bca-keluarga', source: 'default', check: false })
    expect(find(r, 'BIAYA ADM KARTU')).toMatchObject({ ownerId: 'bca-keluarga', source: 'default', check: false })
  })

  it('reversal and installment 1/6 follow the Blibli purchase; later installments follow the plan', () => {
    const oct = run(3)
    expect(find(oct, 'REVERSAL CICILAN BCA BLIBLI.COM *121')).toMatchObject({ ownerId: 'bca-sari', check: false, reason: 'Same owner as the purchase it cancels' })
    expect(find(oct, 'CICILAN BCA KE 01 DARI 06, BLIBLI.COM')).toMatchObject({ ownerId: 'bca-sari', source: 'plan', check: false })
    expect(find(run(4), 'CICILAN BCA KE 02 DARI 06, BLIBLI.COM')).toMatchObject({ ownerId: 'bca-sari', source: 'plan', reason: 'Same owner as the earlier installments' })
  })

  it('T-02 Shopee lines keep Check even when history points to one owner', () => {
    const r = run(3)
    const shopee = r.out.filter((_, i) => r.lines[i].description.startsWith('SHOPEE'))
    expect(shopee).toHaveLength(2)
    shopee.forEach((s) => expect(s).toMatchObject({ ownerId: 'bca-sari', check: true, marketplace: true }))
  })
})
