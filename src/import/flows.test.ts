import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, aiConfig, expected, fileOf, importFixture, mockFetch, pdfjsLib, seedCards } from '../../test/import/helpers'
import { AI_CACHE_PREFIX } from '../data/aiCache'
import type { NewDb } from '../data/db'
import { loadLedger } from '../data/repo'
import { draftIssues } from '../domain/draft'
import { monthsLeft } from '../domain/installments'
import type { Payment } from '../domain/types'
import { commitImport, previewImport, resolveNotOnStatement } from './commit'
import { decideDuplicate, ImportError, problems } from './draft'
import { readImport } from './read'

const byDesc = async (db: NewDb, cardId: string, prefix: string) => (await loadLedger(db, cardId)).transactions.filter((t) => t.description.startsWith(prefix))
const unbilledOf = async (db: NewDb, cardId: string) => {
  const l = await loadLedger(db, cardId)
  const id = l.statements.find((s) => s.kind === 'unbilled')!.id
  return { txs: l.transactions.filter((t) => t.statementId === id), pays: l.payments.filter((p) => p.statementId === id) }
}

async function bcaUpToSep(db: NewDb) {
  const cards = await seedCards(db)
  for (const m of ['07', '08', '09']) await importFixture(db, cards.bca, `statements/bca-2026-${m}.pdf`)
  return cards
}

describe('statement import flows (BCA, synthetic household)', () => {
  it('I-08 Unbilled rows and payment lines move into the newer statement with owners and assignments; I-10 the pending GRAB is flagged', async () => {
    const db = freshNewDb()
    const cards = await bcaUpToSep(db)
    const sari = cards.owners.bca.Sari
    const u = await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-10.png')
    expect(u.report).toMatchObject({ target: 'unbilled', added: expect.any(Array), newPayments: [expect.objectContaining({ amount: 200000 })] })
    expect(u.report.added).toHaveLength(3)

    // Tag Watsons to Sari and assign the Unbilled payment line to it.
    const [watsons] = await byDesc(db, cards.bca, 'WATSONS')
    await db.transactions.put({ ...watsons, ownerId: sari, check: false })
    const line = (await unbilledOf(db, cards.bca)).pays[0]
    await db.payments.put({ ...line, allocations: [{ txId: watsons.id, amount: 200000 }] })

    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    expect(report.moved.map((r) => r.description).sort()).toEqual(['GRAMEDIA MATRAMAN', 'WATSONS SENAYAN CITY'])
    expect(report.movedPayments).toEqual([{ date: '2026-09-26', description: 'PEMBAYARAN - MBCA', amount: 200000 }])
    const after = await loadLedger(db, cards.bca)
    const moved = after.transactions.find((t) => t.id === watsons.id)!
    expect(moved).toMatchObject({ statementId: report.statementId, ownerId: sari, check: false })
    expect(after.payments.find((p) => p.id === line.id)).toMatchObject({ source: 'statement', statementId: report.statementId, allocations: [{ txId: watsons.id, amount: 200000 }] })

    // GRAB 27.000 on 9 Oct never reached the statement.
    expect(report.notOnStatement).toEqual([{ date: '2026-10-09', description: 'GRAB* A-1PENDING JAKARTA PUSATID', amount: 27000 }])
    const unb = await unbilledOf(db, cards.bca)
    expect(unb.txs.map((t) => t.description)).toEqual(['GRAB* A-1PENDING JAKARTA PUSATID'])
    expect(draftIssues(after, report.statementId).notOnStatementRows).toEqual([unb.txs[0].id])

    await resolveNotOnStatement(db, unb.txs[0].id, 'keepWaiting')
    expect(draftIssues(await loadLedger(db, cards.bca), report.statementId).notOnStatementRows).toEqual([])
    await resolveNotOnStatement(db, unb.txs[0].id, 'delete')
    expect((await unbilledOf(db, cards.bca)).txs).toEqual([])
    await expect(resolveNotOnStatement(db, 'nope', 'delete')).rejects.toThrow(ImportError)
  })

  it('I-10 deleting a not-on-statement row returns its payment to To assign', async () => {
    const db = freshNewDb()
    const cards = await bcaUpToSep(db)
    await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-10.png')
    const [grab] = await byDesc(db, cards.bca, 'GRAB* A-1PENDING')
    const line = (await unbilledOf(db, cards.bca)).pays[0]
    await db.payments.put({ ...line, allocations: [{ txId: grab.id, amount: 27000 }] })
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    await resolveNotOnStatement(db, grab.id, 'delete')
    expect((await db.payments.get(line.id))!.allocations).toEqual([])
  })

  it('I-07 installment conversion: original and reversal not counted, payment moved to 1/6, excess becomes the owner\'s deposit', async () => {
    const db = freshNewDb()
    const cards = await bcaUpToSep(db)
    const sari = cards.owners.bca.Sari
    const [blibli] = await byDesc(db, cards.bca, 'BLIBLI.COM *121')
    await db.transactions.put({ ...blibli, ownerId: sari, check: false })
    const hand: Payment = { id: 'hand-1', cardId: cards.bca, source: 'manual', date: '2026-09-20', amount: 1000000, allocations: [{ txId: blibli.id, amount: 1000000 }] }
    await db.payments.put(hand)

    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    expect(report.conversions).toEqual([{ description: 'REVERSAL CICILAN BCA BLIBLI.COM *121', ok: true }])
    const l = await loadLedger(db, cards.bca)
    const original = l.transactions.find((t) => t.id === blibli.id)!
    const reversal = l.transactions.find((t) => t.kind === 'reversal')!
    const inst = l.transactions.find((t) => t.description.startsWith('CICILAN BCA KE 01 DARI 06'))!
    expect(original.cancelled).toBe(true)
    expect(reversal).toMatchObject({ reverses: blibli.id, ownerId: sari })
    expect(inst).toMatchObject({ ownerId: sari, installment: { n: 1, of: 6 } })
    expect(l.payments.find((p) => p.id === 'hand-1')).toMatchObject({ allocations: [{ txId: inst.id, amount: 729367 }], depositOwnerId: sari })
    const plan = l.plans.find((p) => p.id === inst.planId)!
    expect(plan).toMatchObject({ ownerId: sari, monthly: 729367, total: 6, start: '2026-10' })
    expect(monthsLeft(plan, l.statements.find((s) => s.id === report.statementId)!, l, '2026-11-01')).toBe(5)
  })

  it('I-07 a reversal without its original purchase is reported, not converted', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    expect(report.conversions).toEqual([{ description: 'REVERSAL CICILAN BCA BLIBLI.COM *121', ok: false, error: 'originalNotFound' }])
  })

  it('installments link to one plan across statements (same monthly amount, length and start)', async () => {
    const db = freshNewDb()
    const cards = await bcaUpToSep(db)
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    await importFixture(db, cards.bca, 'statements/bca-2026-11.pdf')
    const l = await loadLedger(db, cards.bca)
    const garmin = l.transactions.filter((t) => t.description.includes('GARMIN'))
    expect(garmin.length).toBeGreaterThanOrEqual(4)
    expect(new Set(garmin.map((t) => t.planId)).size).toBe(1)
    expect(l.plans.find((p) => p.id === garmin[0].planId)).toMatchObject({ name: 'GARMIN INDONESIA', total: 12, monthly: 499917 })
  })

  it('I-09 backfilling an older month never touches Unbilled', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-20.png')
    const before = await unbilledOf(db, cards.bca)
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-09.pdf')
    expect(report).toMatchObject({ backfill: true, moved: [], movedPayments: [], notOnStatement: [] })
    expect(await unbilledOf(db, cards.bca)).toEqual(before)
  })

  it('P-13 a hand-recorded payment links to the bank line with the same amount within ±5 days, and stays linked when the line moves', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    const andi = cards.owners.bca.Andi
    await db.payments.put({ id: 'hand-2m', cardId: cards.bca, source: 'manual', date: '2026-10-18', amount: 2000000, allocations: [], forOwnerIds: [andi] })
    await db.payments.put({ id: 'hand-far', cardId: cards.bca, source: 'manual', date: '2026-10-01', amount: 9000, allocations: [] })
    const u = await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-20.png')
    expect(u.report.links).toEqual([{ paymentId: 'hand-2m', lineId: expect.any(String), days: 2 }])
    const lineId = u.report.links[0].lineId
    expect((await db.payments.get('hand-2m'))!.linkedStatementLine).toBe(lineId)
    expect((await db.payments.get('hand-far'))!.linkedStatementLine).toBeUndefined()

    const nov = await importFixture(db, cards.bca, 'statements/bca-2026-11.pdf')
    expect(nov.report.movedPayments).toEqual([expect.objectContaining({ amount: 2000000 })])
    expect(await db.payments.get(lineId)).toMatchObject({ source: 'statement', statementId: nov.report.statementId })
    expect((await db.payments.get('hand-2m'))!.linkedStatementLine).toBe(lineId)
  })

  it('a hand-recorded payment found on no statement is reported as missing', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await db.payments.put({ id: 'hand-bima', cardId: cards.bca, source: 'manual', date: '2026-09-05', amount: 300000, allocations: [] })
    await importFixture(db, cards.bca, 'statements/bca-2026-09.pdf')
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    expect(report.missingPayments).toEqual([{ date: '2026-09-05', description: 'Payment', amount: 300000 }])
  })
})

describe('Unbilled screenshots', () => {
  it('overlapping captures read together count the repeated lines once', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const a = expected('unbilled/bca-unbilled-2026-10-20')
    const b = expected('unbilled/bca-unbilled-2026-10-20-overlap')
    const answer = { ...aiAnswerFor(a), rows: [...aiAnswerFor(a, 0).rows, ...aiAnswerFor(b, 1).rows] }
    const { draft, report } = await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-20.png', {
      answer,
      files: [fileOf('unbilled/bca-unbilled-2026-10-20.png'), fileOf('unbilled/bca-unbilled-2026-10-20-overlap.png')],
    })
    expect(draft.overlapMerged).toBe(2)
    expect(draft.duplicates).toEqual([])
    expect(report).toMatchObject({ overlapMerged: 2 })
    const unb = await unbilledOf(db, cards.bca)
    expect(unb.txs.map((t) => t.description).sort()).toEqual(['GRAB* A-1NOV01EEEE JAKARTA PUSATID', 'HALODOC JAKARTA', 'TOKOPEDIA JAKARTA'])
    expect(unb.pays).toEqual([expect.objectContaining({ source: 'unbilled', amount: 2000000, date: '2026-10-20' })])
  })

  it('I-11 a capture read later asks Keep both / Skip for lines already in Unbilled; never silent', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await importFixture(db, cards.bca, 'unbilled/bca-unbilled-2026-10-20.png')
    const b = expected('unbilled/bca-unbilled-2026-10-20-overlap')
    let draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(b))) }, { cardId: cards.bca, target: 'unbilled', files: [fileOf('unbilled/bca-unbilled-2026-10-20-overlap.png')] })
    expect(draft.duplicates.map((q) => q.where)).toEqual(['Unbilled', 'Unbilled'])
    expect(problems(draft)).toEqual(['Answer 2 duplicate questions: keep both or skip.'])
    await expect(commitImport(db, draft)).rejects.toThrow(/duplicate/)

    draft = decideDuplicate(draft, draft.duplicates[0].rowKey, 'skip')
    draft = decideDuplicate(draft, draft.duplicates[1].rowKey, 'keep')
    const report = await commitImport(db, draft)
    expect(report).toMatchObject({ skippedDuplicates: 1, added: [expect.objectContaining({ description: 'HALODOC JAKARTA' })] })
    expect((await unbilledOf(db, cards.bca)).txs.filter((t) => t.description === 'HALODOC JAKARTA')).toHaveLength(2)
    expect(() => decideDuplicate(draft, 'nope', 'keep')).toThrow(ImportError)
  })

  it('I-11 a repeated payment line is asked about too, and a line already on a statement says where it is', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    const e = expected('unbilled/bca-unbilled-2026-10-10')
    const draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))) }, { cardId: cards.bca, target: 'unbilled', files: [fileOf('unbilled/bca-unbilled-2026-10-10.png')] })
    expect(draft.duplicates.map((q) => q.where)).toEqual(['the 2026-10-12 statement', 'the 2026-10-12 statement', 'the 2026-10-12 statement'])
  })

  it('screenshots with no transactions cannot be saved', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const draft = await readImport({ db, ai: aiConfig(mockFetch({ statementDate: null, dueDate: null, totals: {}, rows: [] })) }, { cardId: cards.bca, target: 'unbilled', files: [fileOf('unbilled/bca-unbilled-2026-10-20.png')] })
    expect(problems(draft)).toEqual(['No transactions were found on these screenshots.'])
  })
})

describe('re-import and duplicates', () => {
  it('I-12 re-importing the same file: detected, no second AI call, rows replaced in place keeping owners and payments', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const first = await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    const [netflix] = await byDesc(db, cards.bca, 'NETFLIX')
    await db.transactions.put({ ...netflix, ownerId: cards.owners.bca.Keluarga, check: false })
    const line = (await loadLedger(db, cards.bca)).payments.find((p) => p.amount === 1470000)!
    await db.payments.put({ ...line, allocations: [{ txId: netflix.id, amount: 186000 }] })

    const fetch = mockFetch()
    const draft = await readImport({ db, ai: aiConfig(fetch), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    expect(fetch).not.toHaveBeenCalled()
    expect(draft.fromCache).toBe(true)
    expect(draft.alreadyImported).toMatchObject({ statementId: first.report.statementId })
    expect(draft.replaces).toEqual({ statementId: first.report.statementId, statementDate: '2026-10-12' })

    const preview = await previewImport(db, draft)
    expect(preview).toMatchObject({ kept: 13, added: [], removed: [] })
    const report = await commitImport(db, draft)
    expect(report).toMatchObject({ statementId: first.report.statementId, kept: 13, added: [], removed: [], newPayments: [] })
    const l = await loadLedger(db, cards.bca)
    expect(l.statements.filter((s) => s.kind === 'billed')).toHaveLength(1)
    expect(l.transactions.find((t) => t.id === netflix.id)).toMatchObject({ ownerId: cards.owners.bca.Keluarga, check: false })
    expect(l.payments.find((p) => p.id === line.id)!.allocations).toEqual([{ txId: netflix.id, amount: 186000 }])
  })

  it('I-12 replacing with a different file lists the differences; payments on removed rows go back to To assign', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const hand: Payment = { id: 'hand-x', cardId: cards.bca, source: 'manual', date: '2026-09-27', amount: 1470000, allocations: [] }
    await db.payments.put(hand)
    await importFixture(db, cards.bca, 'statements/bca-2026-10.pdf')
    expect((await db.payments.get('hand-x'))!.linkedStatementLine).toBeTruthy()
    const [gramedia] = await byDesc(db, cards.bca, 'GRAMEDIA')
    const line = (await loadLedger(db, cards.bca)).payments.find((p) => p.amount === 200000)!
    await db.payments.put({ ...line, allocations: [{ txId: gramedia.id, amount: 200000 }] })

    // The corrupt copy prints GRAMEDIA 1 rupiah higher and (in this answer) drops the 1.470.000 payment line.
    const e = expected('statements/bca-2026-10-corrupt')
    const answer = aiAnswerFor(e)
    answer.rows = answer.rows.filter((r) => r.amount !== 1470000)
    const { report } = await importFixture(db, cards.bca, 'statements/bca-2026-10-corrupt.pdf', { answer, acceptDifference: true })
    expect(report.removed).toEqual([
      { date: '2026-10-02', description: 'GRAMEDIA MATRAMAN', amount: 245000 },
      { date: '2026-09-27', description: 'PEMBAYARAN - MBCA', amount: -1470000 },
    ])
    expect(report.added).toEqual([{ date: '2026-10-02', description: 'GRAMEDIA MATRAMAN', amount: 245001 }])
    expect(report.kept).toBe(11)
    expect((await db.payments.get(line.id))!.allocations).toEqual([])
    expect((await db.payments.get('hand-x'))!.linkedStatementLine).toBeUndefined()
  })
})

describe('safety', () => {
  it('I-16 an AI answer with the wrong schema stops the import with a readable error; nothing is saved', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const bad = { rows: [{ date: 'yesterday', description: 'X', amount: 1, credit: false }] }
    await expect(
      readImport({ db, ai: aiConfig(mockFetch(bad)), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] }),
    ).rejects.toThrow('Row 1 of the AI answer has no valid date (got "yesterday").')
    await expect(
      readImport({ db, ai: aiConfig(mockFetch('Sorry, I cannot read that {')), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] }),
    ).rejects.toThrow(/not valid JSON/)
    expect(await db.transactions.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
    expect(await db.statements.where('kind').equals('billed').count()).toBe(0)
    expect(await db.meta.where('key').startsWith(AI_CACHE_PREFIX).count()).toBe(0)
  })

  it('a failing write rolls the whole import back (single transaction)', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/bca-2026-10')
    const draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    const spy = vi.spyOn(db.plans, 'bulkPut').mockRejectedValueOnce(new Error('disk full'))
    await expect(commitImport(db, draft)).rejects.toThrow('disk full')
    spy.mockRestore()
    expect(await db.transactions.count()).toBe(0)
    expect(await db.statements.where('kind').equals('billed').count()).toBe(0)
  })

  it('refuses a draft for a card that is gone, files that are not statements, and a PDF as Unbilled', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const ai = aiConfig(mockFetch())
    await expect(readImport({ db, ai }, { cardId: 'nope', target: 'statement', files: [] })).rejects.toThrow('Pick a card first.')
    await expect(readImport({ db, ai }, { cardId: cards.bca, target: 'statement', files: [] })).rejects.toThrow('Choose a file first.')
    await expect(readImport({ db, ai }, { cardId: cards.bca, target: 'statement', files: [{ name: 'a.txt', type: 'text/plain', bytes: new Uint8Array(1) }] })).rejects.toThrow(/one PDF/)
    await expect(readImport({ db, ai, pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'unbilled', files: [fileOf('statements/bca-2026-10.pdf')] })).rejects.toThrow(/not a PDF/)
    await expect(readImport({ db, ai }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })).rejects.toThrow(/PDF reader/)

    const e = expected('statements/bca-2026-10')
    const draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    await expect(commitImport(db, { ...draft, cardId: 'gone' })).rejects.toThrow('This card no longer exists.')
    await expect(previewImport(db, { ...draft, cardId: 'gone' })).rejects.toThrow('This card no longer exists.')
  })
})
