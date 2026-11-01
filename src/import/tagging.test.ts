// Import + tagging (Slice 7): the synthetic BCA statements imported in order through the real import plan. New rows
// are tagged by rules, learned history and linked purchases; the user reviews only the Check rows.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { importFixture, seedCards } from '../../test/import/helpers'
import { saveRule, setOwner } from '../data/rules'
import type { Transaction } from '../domain/types'

/** Expected rows also carry the owner and the Check flag (test/fixtures/statements/*.expected.json). */
interface Row {
  txDate: string
  description: string
  amount: number
  kind: string
  expectedOwner: string | null
  needsCheck?: boolean
}

const BCA = ['bca-2026-07', 'bca-2026-08', 'bca-2026-09', 'bca-2026-10', 'bca-2026-11']

// The household's BCA rules: the two it keeps from the start, plus the ones it saved with "Always tag" the first time
// each merchant came up (the import's AI does not guess owners, so first-seen merchants need a rule or a review).
const RULES: [match: 'startsWith' | 'contains', pattern: string, owner: string][] = [
  ['startsWith', 'GRAB*', 'Andi'],
  ['contains', 'GARMIN', 'Andi'],
  ['contains', 'GRAMEDIA', 'Bima'],
  ['contains', 'RS PONDOK INDAH', 'Medis'],
  ['contains', 'KIDZANIA', 'Bima'],
  ['contains', 'BLIBLI.COM *121 SEPEDA', 'Sari'],
  ['contains', 'WATSONS', 'Sari'],
  ['contains', 'HALODOC', 'Medis'],
]

describe('import tags new rows (BCA Jul–Nov in order)', () => {
  it('T-01 T-02 T-03 M-07 rows without Check are already right; after reviewing the Check rows every owner matches the expected file', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const owner = (name: string) => cards.owners.bca[name]
    for (const [match, pattern, name] of RULES) await saveRule(db, { cardId: cards.bca, match, pattern, ownerId: owner(name) })

    let checks = 0
    let marketplace = 0
    for (const file of BCA) {
      const { report, expected } = await importFixture(db, cards.bca, `statements/${file}.pdf`)
      const stored = await db.transactions.where('statementId').equals(report.statementId).toArray()
      const unused = new Set(stored.map((t) => t.id))
      const pairs: [Transaction, Row][] = (expected.rows as unknown as Row[])
        .filter((r) => r.kind !== 'payment')
        .map((r) => {
          const t = stored.find((x) => unused.has(x.id) && x.date === r.txDate && x.description === r.description && x.amount === r.amount)!
          unused.delete(t.id)
          return [t, r]
        })
      for (const [t, r] of pairs) {
        const where = `${file}: ${r.description} ${r.amount}`
        expect(t.tagSource, where).toBeDefined() // every imported row records how it was tagged
        if (r.needsCheck) expect(t.check, where).toBe(true)
        if (!t.check) expect(t.ownerId, where).toBe(owner(r.expectedOwner!))
      }
      // The user reviews the Check rows.
      for (const [t, r] of pairs.filter(([t]) => t.check)) await setOwner(db, t.id, owner(r.expectedOwner!))
      checks += pairs.filter(([t]) => t.check).length
      marketplace += pairs.filter(([, r]) => r.needsCheck).length

      for (const [t, r] of pairs) expect((await db.transactions.get(t.id))!.ownerId, `${file}: ${r.description}`).toBe(owner(r.expectedOwner!))
    }
    // Check rows: the marketplace lines plus their marketplace refund.
    expect(checks).toBe(marketplace + 1)

    // Plans started by these imports belong to their purchase's owner.
    const plans = await db.plans.where('cardId').equals(cards.bca).toArray()
    expect(plans.map((p) => [p.name, p.ownerId]).sort()).toEqual(
      [
        ['BLIBLI.COM', owner('Sari')],
        ['GARMIN INDONESIA', owner('Andi')],
      ].sort(),
    )
  })

  it('without rules or history: unmatched rows get the card default without Check; fees and interest too (M-07); marketplace rows Check (T-02)', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-08.pdf')
    const rows = await db.transactions.where('statementId').equals(report.statementId).toArray()
    const keluarga = cards.owners.bca.Keluarga
    expect(rows.find((t) => t.description === 'NETFLIX.COM')).toMatchObject({ ownerId: keluarga, tagSource: 'default' })
    expect(rows.find((t) => t.description === 'NETFLIX.COM')!.check).toBeUndefined()
    expect(rows.find((t) => t.kind === 'interest')).toMatchObject({ ownerId: keluarga, tagSource: 'default' })
    for (const t of rows.filter((x) => x.description.startsWith('SHOPEE'))) expect(t.check).toBe(true)
    expect(rows.find((t) => t.kind === 'refund')).toMatchObject({ check: true, tagSource: 'auto' })
  })
})
