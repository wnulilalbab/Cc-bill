import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, expected, importFixture, mockFetch, aiConfig, pdfjsLib, seedCards, fileOf } from '../../test/import/helpers'
import { reconcileStatement } from '../domain/reconcile'
import { loadLedger } from '../data/repo'
import { checkTotals, setRowAmount, setTypedTotal, problems } from './draft'
import { readImport } from './read'
import { commitImport } from './commit'

const STATEMENTS = [
  'statements/bca-2026-07.pdf',
  'statements/bca-2026-08.pdf',
  'statements/bca-2026-09.pdf',
  'statements/bca-2026-10.pdf',
  'statements/bca-2026-11.pdf',
  'statements/mandiri-2026-10.pdf',
  'statements/mandiri-2026-11.pdf',
  'screenshots/mandiri-2026-08-p1.png',
  'screenshots/mandiri-2026-09-p1.png',
]

const rowShape = (r: { date: string; description: string; amount: number; kind: string }) => `${r.date}|${r.description}|${r.amount}|${r.kind}`

describe('every synthetic statement', () => {
  it.each(STATEMENTS)('I-01 %s imports with totals matching the printed figures and the expected rows', async (path) => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected(path.replace(/(-p1)?\.(pdf|png)$/, ''))
    const { report, draft } = await importFixture(db, cards[e.card], path)

    expect(checkTotals(draft)).toMatchObject({ ok: true, difference: 0 })
    expect(report.difference).toBe(0)
    const ledger = await loadLedger(db, cards[e.card])
    const stmt = ledger.statements.find((s) => s.id === report.statementId)!
    expect(stmt).toMatchObject({ kind: 'billed', statementDate: e.statementDate, dueDate: e.dueDate })
    if (stmt.kind === 'billed') expect(stmt.printed.newBalance).toBe(e.printed!.newBalance)
    expect(stmt.kind === 'billed' && stmt.printed.prevBalance).toBe(e.printed!.prevBalance)
    expect(reconcileStatement(ledger, stmt.id)).toMatchObject({ ok: true, difference: 0 })
    if (e.format === 'pdf') expect(reconcileStatement(ledger, stmt.id).computed).toMatchObject({ credits: e.printed!.credits, purchases: e.printed!.purchases, feesInterest: e.printed!.feesInterest })

    const stored = [
      ...ledger.transactions.filter((t) => t.statementId === stmt.id),
      ...ledger.payments.filter((p) => p.statementId === stmt.id).map((p) => ({ date: p.date, description: p.description!, amount: -p.amount, kind: 'payment' })),
    ]
    expect(stored.map(rowShape).sort()).toEqual(e.rows.map((r) => rowShape({ ...r, date: r.txDate })).sort())
    for (const r of e.rows.filter((x) => x.installment)) {
      const t = ledger.transactions.find((x) => x.description === r.description && x.statementId === stmt.id)!
      expect(t.installment).toEqual({ n: r.installment!.n, of: r.installment!.of })
      expect(t.planId).toBeTruthy()
    }
  })

  it('I-02 corrupt October: the totals check reports exactly Rp 1; fixing the row re-runs the check to a match', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/bca-2026-10-corrupt')
    const draft0 = await readImport(
      { db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib },
      { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10-corrupt.pdf')] },
    )
    const check = checkTotals(draft0)!
    expect(check.ok).toBe(false)
    expect(check.difference).toBe(e.expectedDifference)
    expect(check.difference).toBe(1)

    const gramedia = draft0.rows.find((r) => r.description.startsWith('GRAMEDIA'))!
    const fixed = setRowAmount(draft0, gramedia.key, gramedia.amount - 1)
    expect(checkTotals(fixed)).toMatchObject({ ok: true, difference: 0 })
    const report = await commitImport(db, fixed)
    expect(report.difference).toBe(0)
  })

  it('I-02 saving with a difference needs confirmation, and the saved statement keeps reporting it', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await expect(importFixture(db, cards.bca, 'statements/bca-2026-10-corrupt.pdf')).rejects.toThrow('The totals differ by Rp 1. Confirm to save anyway.')
    expect(await db.statements.where('kind').equals('billed').count()).toBe(0)
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10-corrupt.pdf', { acceptDifference: true })
    expect(report.difference).toBe(1)
    expect(reconcileStatement(await loadLedger(db, cards.bca), report.statementId).difference).toBe(1)
  })

  it('an empty statement (no transactions) imports with zero totals and no rows', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const { report, draft } = await importFixture(db, cards.bca, 'statements/bca-2026-12-empty.pdf')
    expect(draft.rows).toEqual([])
    expect(problems(draft)).toEqual([])
    expect(report).toMatchObject({ difference: 0, added: [], newPayments: [] })
    const ledger = await loadLedger(db, cards.bca)
    expect(ledger.statements.find((s) => s.id === report.statementId)).toMatchObject({ statementDate: '2026-12-12', printed: { newBalance: 0 } })
    expect(ledger.transactions).toEqual([])
  })

  it('I-13 a screenshot statement for a past month needs the typed total, then reconciles', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('screenshots/mandiri-2026-08')
    let draft = await readImport(
      { db, ai: aiConfig(mockFetch(aiAnswerFor(e))) },
      { cardId: cards.mandiri, target: 'statement', files: [fileOf('screenshots/mandiri-2026-08-p1.png')] },
    )
    expect(draft.format).toBe('screenshots')
    expect(problems(draft)).toContain("Type the bank's total from the first screenshot.")
    expect(checkTotals(draft)).toBeNull()
    await expect(commitImport(db, draft)).rejects.toThrow(/Type the bank's total/)
    expect(await db.statements.where('kind').equals('billed').count()).toBe(0)

    draft = setTypedTotal(draft, e.printed!.newBalance + 500)
    expect(checkTotals(draft)!.difference).toBe(-500)
    draft = setTypedTotal(draft, e.printed!.newBalance)
    expect(checkTotals(draft)).toMatchObject({ ok: true })
    const report = await commitImport(db, draft)
    expect(report.difference).toBe(0)
  })

  it('I-13 the previous balance of a later screenshot statement falls back to the statement before', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await importFixture(db, cards.mandiri, 'screenshots/mandiri-2026-08-p1.png')
    const e = expected('screenshots/mandiri-2026-09')
    const answer = aiAnswerFor(e)
    answer.totals.prevBalance = null
    const draft = await readImport({ db, ai: aiConfig(mockFetch(answer)) }, { cardId: cards.mandiri, target: 'statement', files: [fileOf('screenshots/mandiri-2026-09-p1.png')] })
    expect(draft.printed.prevBalance).toBe(e.printed!.prevBalance)
    expect(checkTotals(setTypedTotal(draft, e.printed!.newBalance))).toMatchObject({ ok: true })
  })
})
