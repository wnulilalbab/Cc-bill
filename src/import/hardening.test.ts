import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, aiConfig, expected, fileOf, mockFetch, pdfjsLib, seedCards } from '../../test/import/helpers'
import { deleteCard, saveCard, type CardRecord } from '../data/cards'
import { commitImport } from './commit'
import { checkTotals, confirmTotalsChecked, problems, setPrinted, totalsConflicts, totalsVerified } from './draft'
import { hasPassword, recallPassword, rememberPassword } from './passwords'
import { LIMITS, PdfReadError, readPdfPages, type PdfJsLike } from './pdf'
import { readImport, type ImportFile } from './read'
import { holderNameWords, printedBalances, redactStatement } from './redact'

const sent = (lines: string[], opts = {}) => redactStatement([lines], opts).split('\n').slice(1)

describe('I-05 redaction: review variants never leave the device', () => {
  it('drops address, name and bare-number lines', () => {
    const leaks = [
      '12 JALAN MERDEKA RAYA',
      '7 Mawar Residence Blok C',
      '12 OKTOBER 2026 ANDI PRATAMA',
      '11/10/2026 ANDI PRATAMA',
      '10000001',
      '40111',
      '081234567890',
      '12 JALAN MERDEKA 45',
    ]
    expect(sent(leaks)).toEqual([])
  })

  it('masks card numbers in every grouping and masking style', () => {
    const cards = ['4556.7712.3456.1234', '3782 822463 10005', 'XXXX XXXX XXXX 1234', '4556 77•• •••• 1234', '4556-77XX-XXXX-1234', '5299 12** **** 4321', '4556771234561234', 'xxxx-xxxx-xxxx-1234']
    for (const c of cards) {
      expect(sent([`02-OKT 03-OKT TRANSFER ${c} 245.000`]), c).toEqual(['02-OKT 03-OKT TRANSFER [card] 245.000'])
      expect(sent([`TAGIHAN BARU : RP 3.281.096 ${c}`]), c).toEqual(['TAGIHAN BARU: RP 3.281.096'])
    }
  })

  it('keeps transaction lines only with a date at the start and an amount at the end', () => {
    expect(sent(['15-SEP 15-SEP REVERSAL CICILAN BCA BLIBLI.COM *121 4.376.200 CR', '30-Sep-26 30-Sep-26 PAYMENT THANK YOU - Livin 377,933.00 CR', '05-OKT 06-OKT RS PONDOK INDAH 1.150.000'])).toHaveLength(3)
    expect(sent(['15-SEP 15-SEP ANDI PRATAMA', '15-SEP NOTE: CALL 081234567890'])).toEqual([])
  })

  it('keeps only amounts with thousands separators on number lines', () => {
    expect(sent(['5.846.117 6.046.200 3.310.284 170.895 3.281.096', '0 0 0 0 0', '10000001 40111'])).toEqual(['5.846.117 6.046.200 3.310.284 170.895 3.281.096', '0 0 0 0 0'])
  })

  it('labelled values keep only the date or amount, never the rest of the line', () => {
    expect(sent(['TANGGAL REKENING : 12 OKTOBER 2026 ANDI PRATAMA', 'Statement Date 11/10/2026 ANDI PRATAMA', 'NOMOR CUSTOMER : 10000001'])).toEqual(['TANGGAL REKENING: 12 OKTOBER 2026', 'Statement Date: 11/10/2026'])
  })

  it('blocks the holder name from the first page and the card last 4 from the card record', () => {
    expect(holderNameWords(['BAPAK ANDI PRATAMA', 'Lembar Tagihan Kartu Kredit / Credit Card Statement', 'JL MELATI NO 7'])).toEqual(['ANDI', 'PRATAMA'])
    const text = redactStatement([['ANDI PRATAMA REKENING KARTU KREDIT', '02-OKT 03-OKT TRANSFER KE ANDI PRATAMA REF 1234 245.000', '03-OKT 03-OKT SITI RAHAYU 5.000']], { last4: '1234', holderName: 'Siti Rahayu' })
    expect(text).toContain('02-OKT 03-OKT TRANSFER KE ANDI PRATAMA REF [card] 245.000') // the card's name replaces the guess
    expect(text).toContain('03-OKT 03-OKT [name] [name] 5.000')
    expect(redactStatement([['02-OKT 03-OKT A 1.234']], { last4: '1234' })).toContain('A 1.234')
    expect(redactStatement([['02-OKT 03-OKT A 9.000']], { last4: 'x' })).toContain('A 9.000')
  })
})

describe('round 2: names, addresses', () => {
  it('bank and legal-entity words on page 1 are never taken for the holder name', () => {
    expect(holderNameWords(['PT BANK CENTRAL ASIA TBK', 'KARTU KREDIT', 'CABANG PUSAT'])).toEqual([])
    expect(redactStatement([['PT BANK CENTRAL ASIA TBK', '02-OKT 03-OKT ASIA TRAVEL CENTRAL PARK 245.000']])).toContain('02-OKT 03-OKT ASIA TRAVEL CENTRAL PARK 245.000')
    expect(holderNameWords(['PT BANK MANDIRI (PERSERO) TBK', 'BAPAK ANDI PRATAMA'])).toEqual(['ANDI', 'PRATAMA'])
  })

  it('the holder name from the card is blocked even when the statement prints it on lines 4–5', () => {
    const page = ['REKENING KARTU KREDIT', 'LEMBAR TAGIHAN', 'INFORMASI', 'ANDI', 'PRATAMA', '02-OKT 03-OKT TRANSFER ANDI PRATAMA 245.000', '03-OKT 03-OKT PRATAMA MOTOR 9.000']
    expect(redactStatement([page])).toContain('TRANSFER ANDI PRATAMA 245.000') // the guess cannot see lines 4–5
    const text = redactStatement([page], { holderName: 'Andi Pratama' })
    expect(text).toContain('02-OKT 03-OKT TRANSFER [name] [name] 245.000')
    expect(text).not.toMatch(/ANDI|PRATAMA/)
  })

  it('the card record carries the holder name into the import, and saveCard keeps it', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, { name: 'Synthetic', bank: 'BCA', last4: '1234', holderName: ' Watsons ', statementDay: '12', palette: 'blue', owners: [{ name: 'Andi', color: '#000' }], defaultIndex: 0 })
    expect((await db.cards.get(id)) as CardRecord).toMatchObject({ holderName: 'Watsons' })
    await saveCard(db, { id, name: 'Synthetic 2', bank: 'BCA', last4: '1234', statementDay: '12', palette: 'blue', owners: [{ id: (await db.owners.where('cardId').equals(id).first())!.id, name: 'Andi', color: '#000' }], defaultIndex: 0 })
    expect((await db.cards.get(id)) as CardRecord).toMatchObject({ holderName: 'Watsons' })
    const fetch = mockFetch(aiAnswerFor(expected('statements/bca-2026-10')))
    await readImport({ db, ai: aiConfig(fetch), pdfjs: pdfjsLib }, { cardId: id, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    const payload = fetch.mock.calls[0][1].body
    expect(payload).toContain('[name] SENAYAN CITY')
    await saveCard(db, { id, name: 'Synthetic 2', bank: 'BCA', last4: '1234', holderName: '', statementDay: '12', palette: 'blue', owners: [{ id: (await db.owners.where('cardId').equals(id).first())!.id, name: 'Andi', color: '#000' }], defaultIndex: 0 })
    expect(((await db.cards.get(id)) as CardRecord).holderName).toBeUndefined()
  })

  it('address lines that start like a date and end in a small number are dropped', () => {
    expect(sent(['17 AGUSTUS RAYA NO 5', '12 JUNI RESIDENCE BLOK 7', '17 AGUSTUS RAYA NO 15'])).toEqual([])
    expect(sent(['17-AGU 18-AGU TOKO 5,00', '17-AGU 18-AGU TOKO 5.000'])).toEqual(['17-AGU 18-AGU TOKO 5,00', '17-AGU 18-AGU TOKO 5.000'])
  })

  it('amounts under Rp 1.000: kept after two dates (BCA prints "500"), with or without CR; never on a one-date line', () => {
    const rows = ['12-OKT 12-OKT BEA METERAI 500', '03-OKT 04-OKT PARKIR 7', '05-OKT 05-OKT CASHBACK 999 CR', '06/10 06/10 TOLL 750', '07-OKT 07-OKT KOPI RP 950']
    expect(sent(rows)).toEqual(rows)
    expect(sent(['12 OKTOBER RAYA NO 500', '17 AGUSTUS BLOK 999', '12-OKT 12-OKT TOKO 1000', '12-OKT 12-OKT TOKO 12345'])).toEqual([])
    expect(sent(['12-OKT 12-OKT ANDI PRATAMA 500'], { holderName: 'Andi Pratama' })).toEqual(['12-OKT 12-OKT [name] [name] 500'])
  })
})

describe('on-device totals cross-check (prompt-injection guard)', () => {
  it('reads the printed balances from the redacted text (BCA and Mandiri)', () => {
    expect(printedBalances('SALDO SEBELUMNYA 5.846.117\nTAGIHAN BARU: RP 3.281.096')).toEqual({ prevBalance: 5846117, newBalance: 3281096 })
    expect(printedBalances('Tagihan Bulan Lalu 377,933.00\nTotal Balance (IDR): 647,034.00')).toEqual({ prevBalance: 377933, newBalance: 647034 })
    expect(printedBalances('nothing')).toEqual({ prevBalance: null, newBalance: null })
  })

  it('a merchant line cannot pose as the printed total; two different printed totals are ambiguous', () => {
    const spoof = redactStatement([['01-OKT 02-OKT TAGIHAN BARU: RP 1 100.000', 'TAGIHAN BARU : RP 3.281.096', 'SALDO SEBELUMNYA 5.846.117']])
    expect(spoof).toContain('01-OKT 02-OKT TAGIHAN BARU: RP 1 100.000')
    expect(printedBalances(spoof)).toEqual({ prevBalance: 5846117, newBalance: 3281096 })
    const twice = redactStatement([['TAGIHAN BARU : RP 3.281.096', 'SALDO SEBELUMNYA 5.846.117'], ['TAGIHAN BARU : RP 1', 'SALDO SEBELUMNYA 5.846.117']])
    expect(printedBalances(twice)).toEqual({ prevBalance: 5846117, newBalance: 'ambiguous' })
    // The same total repeated on every page is not ambiguous.
    expect(printedBalances('TAGIHAN BARU: RP 1.000\nTAGIHAN BARU: RP 1.000')).toMatchObject({ newBalance: 1000 })
  })

  it('a PDF whose printed totals cannot be read is never shown as matching; the user can confirm by eye', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/bca-2026-10')
    const draft = await readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    expect(totalsVerified(draft)).toBe(true)
    const missing = { ...draft, deviceTotals: { prevBalance: 'ambiguous' as const, newBalance: null } }
    expect(totalsConflicts(missing).map((c) => c.reason)).toEqual(['ambiguous', 'notFound'])
    expect(problems(missing)).toEqual([
      "Totals can't be confirmed (the statement shows more than one previous balance). Check it against the statement.",
      "Totals can't be confirmed (printed new balance not found). Check it against the statement.",
    ])
    expect(totalsVerified(missing)).toBe(false)
    await expect(commitImport(db, missing)).rejects.toThrow(/can't be confirmed/)
    const checked = confirmTotalsChecked(missing)
    expect(problems(checked)).toEqual([])
    expect(totalsVerified(checked)).toBe(false)
    expect(totalsConflicts({ ...draft, deviceTotals: undefined }).map((c) => c.reason)).toEqual(['notFound', 'notFound'])
    expect(totalsConflicts({ ...checked, deviceTotals: { prevBalance: 1, newBalance: null } })).toEqual([{ field: 'prevBalance', reason: 'differs', ai: e.printed!.prevBalance, printed: 1 }])
  })

  it('an AI total that disagrees with the printed one is an open question; the check never says "match"', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/bca-2026-10')
    // An injected instruction could make the AI drop a row and lower the total so that everything "matches".
    const answer = aiAnswerFor(e)
    answer.rows = answer.rows.filter((r) => !r.description.startsWith('NETFLIX'))
    answer.totals.newBalance = e.printed!.newBalance - 186000
    const draft = await readImport({ db, ai: aiConfig(mockFetch(answer)), pdfjs: pdfjsLib }, { cardId: cards.bca, target: 'statement', files: [fileOf('statements/bca-2026-10.pdf')] })
    expect(draft.deviceTotals).toEqual({ prevBalance: e.printed!.prevBalance, newBalance: e.printed!.newBalance })
    expect(checkTotals(draft)!.ok).toBe(true) // the AI's own figures agree with each other…
    expect(totalsConflicts(draft)).toEqual([{ field: 'newBalance', reason: 'differs', ai: e.printed!.newBalance - 186000, printed: e.printed!.newBalance }])
    expect(problems(draft)[0]).toMatch(/new balance read by the AI .* is not the one printed/)
    await expect(commitImport(db, draft, { acceptDifference: true })).rejects.toThrow(/not the one printed/)
    const fixed = setPrinted(draft, { newBalance: e.printed!.newBalance })
    expect(totalsConflicts(fixed)).toEqual([])
    expect(checkTotals(fixed)).toMatchObject({ ok: false, difference: -186000 }) // …and the missing row shows up
  })
})

describe('caps (before any AI call)', () => {
  const read = async (files: ImportFile[], target: 'statement' | 'unbilled' = 'unbilled', pdfjs: PdfJsLike = pdfjsLib) => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const fetch = mockFetch()
    const run = readImport({ db, ai: aiConfig(fetch), pdfjs }, { cardId: cards.bca, target, files })
    return { run, fetch }
  }
  const png = (name: string, size = 10): ImportFile => ({ name, type: 'image/png', bytes: new Uint8Array(size) })

  it('at most 10 screenshots, each at most 8 MB', async () => {
    let r = await read(Array.from({ length: LIMITS.images + 1 }, (_, i) => png(`s${i}.png`)))
    await expect(r.run).rejects.toThrow('Choose at most 10 screenshots at a time.')
    r = await read([png('big.png', LIMITS.imageBytes + 1)])
    await expect(r.run).rejects.toThrow('big.png is larger than 8 MB.')
    expect(r.fetch).not.toHaveBeenCalled()
  })

  it('PDF at most 15 MB and 30 pages', async () => {
    await expect(readPdfPages(pdfjsLib, new Uint8Array(LIMITS.pdfBytes + 1))).rejects.toThrow(/larger than 15 MB/)
    const destroy = vi.fn(async () => {})
    const many: PdfJsLike = { getDocument: () => ({ promise: Promise.resolve({ numPages: 31, getPage: vi.fn(), destroy }) }) }
    const r = await read([{ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array(10) }], 'statement', many)
    await expect(r.run).rejects.toThrow('This PDF has 31 pages; a statement has at most 30. Check the file.')
    await expect(r.run).rejects.toThrow(PdfReadError)
    expect(destroy).toHaveBeenCalled()
    expect(r.fetch).not.toHaveBeenCalled()
  })

  it('redacted text at most 200k characters', async () => {
    const line = '02-OKT 03-OKT MERCHANT 245.000'
    const page = { getTextContent: async () => ({ items: Array.from({ length: 800 }, (_, i) => ({ str: line, transform: [1, 0, 0, 1, 0, 10_000 - i * 10] })) }) }
    const huge: PdfJsLike = { getDocument: () => ({ promise: Promise.resolve({ numPages: 10, getPage: async () => page }) }) }
    const r = await read([{ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array(10) }], 'statement', huge)
    await expect(r.run).rejects.toThrow('This PDF holds far more text than a card statement. Check the file.')
    expect(r.fetch).not.toHaveBeenCalled()
  })

  it('pdf.js runs without eval and is always destroyed (also when opening fails)', async () => {
    const docDestroy = vi.fn(async () => {})
    const getDocument = vi.fn(() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }), destroy: docDestroy }) }))
    await readPdfPages({ getDocument } as unknown as PdfJsLike, new Uint8Array(2))
    expect((getDocument.mock.calls as unknown as [{ isEvalSupported: boolean }][])[0][0].isEvalSupported).toBe(false)
    expect(docDestroy).toHaveBeenCalledTimes(1)

    const taskDestroy = vi.fn(async () => Promise.reject(new Error('already gone')))
    const failing = { getDocument: () => ({ promise: Promise.reject({ name: 'PasswordException', code: 1 }), destroy: taskDestroy }) } as unknown as PdfJsLike
    await expect(readPdfPages(failing, new Uint8Array(2))).rejects.toMatchObject({ reason: 'needed' })
    expect(taskDestroy).toHaveBeenCalledTimes(1)
  })
})

describe('warnings', () => {
  it('the printed date wins; a file-name month that disagrees is shown as a warning', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected('statements/mandiri-2026-10')
    const read = (name: string) =>
      readImport({ db, ai: aiConfig(mockFetch(aiAnswerFor(e))), pdfjs: pdfjsLib }, { cardId: cards.mandiri, target: 'statement', files: [fileOf('statements/mandiri-2026-10.pdf', name)], password: 'test1234' })
    const d = await read('CC_eBilling2026-09-11.pdf')
    expect(d.statementDate).toBe('2026-10-11')
    expect(d.warnings).toEqual(['The file name says Sep 2026, but the statement is dated Oct 2026. The printed date is used.'])
    expect(problems(d)).toEqual([])
    await db.meta.clear()
    expect((await read('CC_eBilling2026-10-11.pdf')).warnings).toEqual([])
  })
})

describe('I-04 remembered password and the card', () => {
  it('deleting a card deletes its remembered password', async () => {
    const db = freshNewDb()
    const id = await saveCard(db, { name: 'Synthetic', bank: 'Mandiri', last4: '', statementDay: '', palette: 'blue', owners: [], defaultIndex: -1 })
    await rememberPassword(db, id, 'test1234')
    await rememberPassword(db, 'other-card', 'pw')
    expect(await hasPassword(db, id)).toBe(true)
    await deleteCard(db, id)
    expect(await hasPassword(db, id)).toBe(false)
    expect(await recallPassword(db, 'other-card')).toBe('pw')
  })
})
