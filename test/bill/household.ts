// Bill test helpers: the fictional household (test/fixtures) imported through the real import path, plus
// "assign every payment" for the totals-equal-the-bank checks. Synthetic data only.
import { draftFromPayment, fillOldestFirst, savePayment } from '../../src/domain/allocate'
import { countedPayments } from '../../src/domain/amounts'
import type { NewDb } from '../../src/data/db'
import { loadLedger } from '../../src/data/repo'
import { expected, importFixture, seedCards, type Expected, type Seeded } from '../import/helpers'

export const BCA_MONTHS = ['07', '08', '09', '10', '11'] as const

/** BCA Keluarga Jul–Nov (PDFs) and Mandiri Pribadi Aug–Sep (screenshots) + Oct–Nov (locked PDFs). */
export async function seedHousehold(db: NewDb, { bca = BCA_MONTHS as readonly string[], mandiri = true } = {}): Promise<Seeded> {
  const cards = await seedCards(db)
  for (const m of bca) await importFixture(db, cards.bca, `statements/bca-2026-${m}.pdf`)
  if (mandiri) {
    for (const m of ['08', '09']) await importFixture(db, cards.mandiri, `screenshots/mandiri-2026-${m}-p1.png`, { target: 'statement' })
    for (const m of ['10', '11']) await importFixture(db, cards.mandiri, `statements/mandiri-2026-${m}.pdf`)
  }
  return cards
}

/**
 * Assigns every counted payment of a card, oldest payment first, to the open charges of every owner, oldest first
 * (the assign page's "Fill oldest first" with everyone selected). Returns what could not be assigned.
 */
export async function assignAll(db: NewDb, cardId: string): Promise<number> {
  let leftover = 0
  const first = await loadLedger(db, cardId)
  const ids = countedPayments(first.payments)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => p.id)
  const owners = (await db.owners.where('cardId').equals(cardId).toArray()).map((o) => o.id)
  for (const id of ids) {
    const ledger = await loadLedger(db, cardId)
    const p = ledger.payments.find((x) => x.id === id)!
    const d = { ...draftFromPayment({ ...p, allocations: [] }, ledger.transactions), ownerIds: owners, multi: true }
    const { draft } = fillOldestFirst(ledger, d)
    const next = savePayment(ledger, p, draft, null)
    leftover += next.amount - next.allocations.reduce((s, a) => s + a.amount, 0)
    await db.payments.put(next)
  }
  return leftover
}

const FILES: Record<'bca' | 'mandiri', string[]> = {
  bca: BCA_MONTHS.map((m) => `statements/bca-2026-${m}`),
  mandiri: ['screenshots/mandiri-2026-08', 'screenshots/mandiri-2026-09', 'statements/mandiri-2026-10', 'statements/mandiri-2026-11'],
}

type ExpectedTagged = Expected & { rows: (Expected['rows'][number] & { expectedOwner: string | null; needsCheck?: boolean })[] }

/**
 * Sets every imported row's owner (and Check) to what its fixture's expected file says, as if the user reviewed the
 * list. Rows are matched by statement, date, amount and description, in order (two identical Shopee lines exist).
 * Returns how many rows were tagged.
 */
export async function tagAsExpected(db: NewDb, cards: Seeded): Promise<number> {
  let n = 0
  for (const key of ['bca', 'mandiri'] as const) {
    const ledger = await loadLedger(db, cards[key])
    const taken = new Set<string>()
    for (const file of FILES[key]) {
      const e = expected(file) as ExpectedTagged
      const s = ledger.statements.find((x) => x.kind === 'billed' && x.statementDate === e.statementDate)
      if (!s) continue
      for (const r of e.rows) {
        if (r.kind === 'payment') continue
        const t = ledger.transactions.find((x) => !taken.has(x.id) && x.statementId === s.id && x.date === r.txDate && x.amount === r.amount && x.description === r.description)
        if (!t) continue
        taken.add(t.id)
        n++
        const ownerId = r.expectedOwner ? cards.owners[key][r.expectedOwner] : null
        const { check: _c, ...rest } = t
        await db.transactions.put({ ...rest, ownerId, tagSource: t.tagSource === 'plan' ? 'plan' : 'manual', ...(r.needsCheck ? { check: true } : {}) })
        // The plan follows its installments' owner.
        if (t.planId) await db.plans.update(t.planId, { ownerId })
      }
    }
  }
  return n
}
