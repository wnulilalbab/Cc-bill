import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, aiConfig, expected, fileOf, mockFetch, pdfjsLib, seedCards } from '../../test/import/helpers'
import type { AiStatement } from '../ai/schema'
import { checkTotals, decideDuplicate, ImportError, mergeOverlaps, printedOf, problems, setCreditKind, setDates, setPrinted, setRowAmount, setTypedTotal, type ImportDraft } from './draft'
import { monthFromFileName } from './month'
import { chargeKind, creditKind, normalizeRow, normalizeRows, sameText, statementRows } from './normalize'
import { commitImport } from './commit'
import { planImport, planName } from './plan'
import { readImport } from './read'

describe('I-14 month from the file name', () => {
  it('reads the bank file names', () => {
    expect(monthFromFileName('CC_eBilling2026-10-11.pdf')).toEqual({ month: '2026-10', date: '2026-10-11' })
    expect(monthFromFileName('22965532_OCT_2026.pdf')).toEqual({ month: '2026-10' })
    expect(monthFromFileName('Downloads/123_OKT_2026.pdf')).toEqual({ month: '2026-10' })
    expect(monthFromFileName('estatement_MEI-2026.pdf')).toEqual({ month: '2026-05' })
    expect(monthFromFileName('bca-2026-10.pdf')).toEqual({ month: '2026-10' })
    expect(monthFromFileName('20261011.pdf')).toEqual({ month: '2026-10', date: '2026-10-11' })
  })
  it('ignores what is not a month', () => {
    expect(monthFromFileName('statement.pdf')).toBeNull()
    expect(monthFromFileName('2026-13-45.pdf')).toBeNull()
    expect(monthFromFileName('XYZ_2026.pdf')).toBeNull()
    expect(monthFromFileName('scan-2026-13.png')).toBeNull()
  })
  it('I-14 the statement date falls back to the file name when the AI did not read it', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const answer = { ...aiAnswerFor(expected('statements/mandiri-2026-10')), statementDate: null }
    const read = (name: string, a: AiStatement) =>
      readImport({ db, ai: aiConfig(mockFetch(a)), pdfjs: pdfjsLib }, { cardId: cards.mandiri, target: 'statement', files: [fileOf('statements/mandiri-2026-10.pdf', name)], password: 'test1234' })
    expect((await read('CC_eBilling2026-10-11.pdf', answer)).statementDate).toBe('2026-10-11')
    await db.meta.clear()
    expect((await read('22965532_OCT_2026.pdf', answer)).statementDate).toBe('2026-10-11') // card's statement day
    await db.meta.clear()
    const d = await read('statement.pdf', answer)
    expect(d.statementDate).toBeNull()
    expect(problems(d)).toContain('Pick the statement date.')
    expect(problems(setDates(d, { statementDate: '2026-10-11' }))).toEqual([])
  })
})

describe('I-06 rows: signs, kinds, credit classification', () => {
  it('credits are negative; PEMBAYARAN → payment, REVERSAL CICILAN → reversal, REFUND → refund', () => {
    const r = (description: string, amount: number, credit: boolean) => normalizeRow({ page: 0, date: '2026-10-01', postDate: '2026-10-01', description, amount, credit }, 'k')
    expect(r('PEMBAYARAN - MBCA', 200000, true)).toMatchObject({ amount: -200000, kind: 'payment' })
    expect(r('PAYMENT THANK YOU - Livin', 377933, true)).toMatchObject({ amount: -377933, kind: 'payment' })
    expect(r('REVERSAL CICILAN BCA BLIBLI.COM *121', 4376200, true)).toMatchObject({ amount: -4376200, kind: 'reversal' })
    expect(r('REFUND SHOPEE Jakarta SelatID', 44631, true)).toMatchObject({ amount: -44631, kind: 'refund' })
    expect(r('CASHBACK PROMO', 10000, true)).toMatchObject({ amount: -10000, kind: 'unknownCredit' })
    expect(r('CICILAN BCA KE 01 DARI 06, BLIBLI.COM', 729367, false)).toMatchObject({ kind: 'installment', installment: { n: 1, of: 6 } })
    expect(r('UNIQLO AEON BSD 002/003', 133333, false)).toMatchObject({ kind: 'installment', installment: { n: 2, of: 3 } })
  })
  it('charge kinds', () => {
    expect(chargeKind('BUNGA')).toBe('interest')
    expect(chargeKind('BIAYA ADM KARTU')).toBe('fee')
    expect(chargeKind('BEA METERAI')).toBe('fee')
    expect(chargeKind('COFFEE BEAN')).toBe('purchase')
    expect(creditKind('SOMETHING')).toBe('unknownCredit')
  })
  it('every fixture row gets the expected kind and sign', () => {
    for (const f of ['statements/bca-2026-08', 'statements/bca-2026-10', 'statements/mandiri-2026-10', 'screenshots/mandiri-2026-09', 'unbilled/bca-unbilled-2026-10-20']) {
      const e = expected(f)
      const rows = normalizeRows(aiAnswerFor(e).rows)
      expect(rows.map((r) => [r.amount, r.kind])).toEqual(e.rows.map((r) => [r.amount, r.kind]))
    }
  })
  it('an unclassified credit counts as a credit in the totals check', () => {
    expect(statementRows([{ key: 'a', page: 0, date: 'd', postDate: 'd', description: 'X', amount: -5, kind: 'unknownCredit' }])).toEqual([{ amount: -5, kind: 'refund' }])
  })
  it('same merchant text ignores case and punctuation; long prefixes match', () => {
    expect(sameText('Grab* A-1', 'GRAB A1')).toBe(true)
    expect(sameText('SHOPEE.CO.ID *AP1260928', 'SHOPEE.CO.ID *AP1260928 JAKARTA BARATID')).toBe(true)
    expect(sameText('TOKO', 'TOKO LILI')).toBe(false)
  })
  it('plan names drop the installment marker', () => {
    expect(planName('CICILAN BCA KE 01 DARI 06, BLIBLI.COM')).toBe('BLIBLI.COM')
    expect(planName('UNIQLO AEON BSD 002/003')).toBe('UNIQLO AEON BSD')
    expect(planName('CICILAN KE 1 DARI 3')).toBe('CICILAN KE 1 DARI 3')
  })
})

describe('the review draft', () => {
  const base = async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/bca-2026-10')
    const draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    return { db, cards, draft, e }
  }

  it('printed totals come from the AI; missing ones are asked for', async () => {
    const { draft, e } = await base()
    expect(printedOf(draft)).toEqual(e.printed)
    const noNew = setPrinted(draft, { newBalance: null, prevBalance: null })
    expect(printedOf(noNew)).toBeNull()
    expect(checkTotals(noNew)).toBeNull()
    expect(problems({ ...noNew, userCheckedTotals: true, deviceTotals: undefined })).toEqual(["Type the statement's new balance.", "Type the statement's previous balance."])
    const partial = setPrinted(draft, { credits: null, minPayment: null })
    expect(printedOf(partial)).toEqual({ ...e.printed, minPayment: undefined, credits: e.printed!.credits })
    expect(problems(setDates(draft, { dueDate: null }))).toEqual(['Pick the due date.'])
  })

  it('an unclassified credit must be answered before saving', async () => {
    const { db, draft } = await base()
    const withCashback: ImportDraft = { ...draft, rows: [...draft.rows, { key: 'cb', page: 1, date: '2026-10-10', postDate: '2026-10-10', description: 'CASHBACK', amount: -10000, kind: 'unknownCredit' }] }
    expect(problems(withCashback)).toEqual(['Say what 1 credit line is: a payment or a refund.'])
    expect(problems({ ...withCashback, rows: [...withCashback.rows, { ...withCashback.rows.at(-1)!, key: 'cb2' }] })).toContain('Say what 2 credit lines are: a payment or a refund.')
    await expect(commitImport(db, withCashback)).rejects.toThrow(/credit line/)
    expect(() => setCreditKind(withCashback, draft.rows.find((r) => r.amount > 0)!.key, 'refund')).toThrow(ImportError)
    expect(() => setCreditKind(withCashback, 'nope', 'refund')).toThrow(ImportError)
    const refund = setCreditKind(withCashback, 'cb', 'refund')
    expect(problems(refund)).toEqual([])
    const report = await commitImport(db, refund, { acceptDifference: true })
    expect(report.added).toContainEqual({ date: '2026-10-10', description: 'CASHBACK', amount: -10000 })
    expect(setCreditKind(withCashback, 'cb', 'payment').rows.at(-1)!.kind).toBe('payment')
  })

  it('editing helpers validate their input', async () => {
    const { draft } = await base()
    expect(() => setRowAmount(draft, draft.rows[0].key, 1.5)).toThrow(ImportError)
    expect(() => setRowAmount(draft, 'nope', 1)).toThrow(ImportError)
    expect(() => setTypedTotal(draft, -1)).toThrow(ImportError)
    expect(() => setTypedTotal(draft, 0.5)).toThrow(ImportError)
    expect(setTypedTotal(draft, null).typedTotal).toBeNull()
    expect(() => decideDuplicate(draft, 'x', 'skip')).toThrow(ImportError)
    expect(problems({ ...draft, duplicates: [{ rowKey: 'r1', existingId: 'x', where: 'Unbilled' }] })).toEqual(['Answer the duplicate question: keep both or skip.'])
  })

  it('a draft from another card is refused', async () => {
    const { db, draft, cards } = await base()
    const card = (await db.cards.get(cards.mandiri))!
    expect(() => planImport({ ledger: { statements: [], transactions: [], payments: [], plans: [] }, card, draft, newId: (p) => p })).toThrow('This import belongs to another card.')
  })

  it('overlap merge: twice on one screenshot = two rows; once on each of two = one row', () => {
    const row = (key: string, page: number, description = 'TOKOPEDIA') => ({ key, page, date: '2026-10-16', postDate: '2026-10-16', description, amount: 320000, kind: 'purchase' as const })
    expect(mergeOverlaps([row('a', 0), row('b', 0), row('c', 1)])).toEqual({ rows: [row('a', 0), row('b', 0)], merged: 1 })
    expect(mergeOverlaps([row('a', 0), row('c', 1), row('d', 1, 'HALODOC')])).toEqual({ rows: [row('a', 0), row('d', 1, 'HALODOC')], merged: 1 })
  })
})
