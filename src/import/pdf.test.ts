import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, aiConfig, expected, fileOf, mockFetch, pdfjsLib, seedCards } from '../../test/import/helpers'
import household from '../../test/fixtures/household.json'
import { idr, idrMandiri } from '../../scripts/fixtures/pdf'
import { linesOf, PdfPasswordError, PdfReadError, readPdfPages, type PdfJsLike } from './pdf'
import { readImport } from './read'
import { redactStatement } from './redact'

const bytes = (p: string) => fileOf(p).bytes

describe('PDF on the device', () => {
  it('extracts each page as printed lines (tables split across pages)', async () => {
    const pages = await readPdfPages(pdfjsLib, bytes('statements/bca-2026-10.pdf'))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('15-SEP 15-SEP REVERSAL CICILAN BCA BLIBLI.COM *121 4.376.200 CR')
    expect(pages[1]).toContain('12-OKT 12-OKT BIAYA ADM KARTU 15.000')
  })

  it('I-03 a locked Mandiri PDF: no password and a wrong one give a clear retry error, the right one opens it', async () => {
    const file = bytes('statements/mandiri-2026-10.pdf')
    await expect(readPdfPages(pdfjsLib, file)).rejects.toThrow(new PdfPasswordError('needed'))
    const wrong = await readPdfPages(pdfjsLib, file, 'wrong-password').catch((e: PdfPasswordError) => e)
    expect(wrong).toBeInstanceOf(PdfPasswordError)
    expect(wrong).toMatchObject({ reason: 'wrong', message: "That password didn't open the file. Try again." })
    // Same bytes, right password: the first attempts did not consume the file.
    const pages = await readPdfPages(pdfjsLib, file, household.password)
    expect(pages[0]).toContain('30-Sep-26 30-Sep-26 PAYMENT THANK YOU - Livin 377,933.00 CR')
  })

  it('I-03 through the import: wrong password stops before any AI call, right password parses', async () => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const fetch = mockFetch(aiAnswerFor(expected('statements/mandiri-2026-10')))
    const req = { cardId: cards.mandiri, target: 'statement' as const, files: [fileOf('statements/mandiri-2026-10.pdf', 'CC_eBilling2026-10-11.pdf')] }
    await expect(readImport({ db, ai: aiConfig(fetch), pdfjs: pdfjsLib }, { ...req, password: 'nope' })).rejects.toMatchObject({ reason: 'wrong' })
    expect(fetch).not.toHaveBeenCalled()
    const draft = await readImport({ db, ai: aiConfig(fetch), pdfjs: pdfjsLib }, { ...req, password: household.password })
    expect(draft.rows).toHaveLength(8)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('treats a PasswordException without a code as "needed" and other failures as unreadable', async () => {
    const failing = (err: unknown): PdfJsLike => ({ getDocument: () => ({ promise: Promise.reject(err) }) })
    await expect(readPdfPages(failing({ name: 'PasswordException' }), new Uint8Array(1))).rejects.toMatchObject({ reason: 'needed' })
    await expect(readPdfPages(failing({ name: 'PasswordException', code: 1 }), new Uint8Array(1), 'x')).rejects.toMatchObject({ reason: 'wrong' })
    await expect(readPdfPages(failing(new Error('Invalid PDF structure')), new Uint8Array(1))).rejects.toThrow(PdfReadError)
    await expect(readPdfPages(pdfjsLib, new TextEncoder().encode('not a pdf'))).rejects.toThrow('This file could not be read as a PDF.')
  })

  it('groups text items into lines top to bottom, left to right', () => {
    const at = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] })
    expect(linesOf([at('B', 50, 700), at('A', 10, 701), at('C', 10, 600), { str: ' ', transform: [1, 0, 0, 1, 0, 0] }, {}])).toEqual(['A B', 'C'])
  })
})

describe('I-05 header stripping', () => {
  const personal = [household.holder, 'PRATAMA', ...household.address, 'MELATI', 'SUKAJADI', '40111', household.cards.bca.customerNo, household.cards.mandiri.customerNo, '4556', '5299', '1234', '4321']

  it.each([
    ['statements/bca-2026-10.pdf', undefined],
    ['statements/mandiri-2026-10.pdf', household.password],
  ])('the AI payload of %s has no name, address or card number, but every transaction line and the totals', async (path, password) => {
    const db = freshNewDb()
    const cards = await seedCards(db)
    const e = expected(path.replace('.pdf', ''))
    const fetch = mockFetch(aiAnswerFor(e))
    await readImport({ db, ai: aiConfig(fetch), pdfjs: pdfjsLib }, { cardId: cards[e.card], target: 'statement', files: [fileOf(path)], password })
    const payload = fetch.mock.calls[0][1].body
    for (const p of personal) expect(payload, p).not.toContain(p)
    const fmt = e.card === 'bca' ? idr : idrMandiri
    for (const r of e.rows) {
      expect(payload).toContain(r.description)
      expect(payload).toContain(fmt(Math.abs(r.amount)))
    }
    for (const total of [e.printed!.prevBalance, e.printed!.newBalance]) expect(payload).toContain(fmt(total))
  })

  it('keeps labelled dates and totals, balance lines, the summary table; masks card numbers; marks pages', () => {
    const text = redactStatement([
      [
        'ANDI PRATAMA REKENING KARTU KREDIT',
        'KEL SUKAJADI TANGGAL REKENING : 12 OKTOBER 2026',
        'BANDUNG 40111 TANGGAL JATUH TEMPO : 28 OKTOBER 2026',
        'TAGIHAN BARU : RP 3.281.096',
        'Tanggal Cetak Tagihan / Statement Date 11-Oct-26',
        'Nomor Kartu / Card Number 5299 12** **** 4321',
        'SALDO SEBELUMNYA 5.846.117',
        '4556-77XX-XXXX-1234 ANDI PRATAMA',
        '02-OKT 03-OKT TRANSFER 4556 7712 3456 1234 245.000',
      ],
      ['TAGIHAN SEBELUMNYA PEMBAYARAN/CR PEMBELANJAAN BIAYA ADM & BUNGA TAGIHAN BARU', '5.846.117 6.046.200 3.310.284 170.895 3.281.096', 'SUB-TOTAL 647,034.00', 'HALAMAN 2 DARI 2'],
    ])
    expect(text.split('\n')).toEqual([
      '--- PAGE 0 ---',
      'TANGGAL REKENING: 12 OKTOBER 2026',
      'TANGGAL JATUH TEMPO: 28 OKTOBER 2026',
      'TAGIHAN BARU: RP 3.281.096',
      'Statement Date: 11-Oct-26',
      'SALDO SEBELUMNYA 5.846.117',
      '02-OKT 03-OKT TRANSFER [card] 245.000',
      '--- PAGE 1 ---',
      'TAGIHAN SEBELUMNYA PEMBAYARAN/CR PEMBELANJAAN BIAYA ADM & BUNGA TAGIHAN BARU',
      '5.846.117 6.046.200 3.310.284 170.895 3.281.096',
      'SUB-TOTAL 647,034.00',
    ])
  })

  it('pdf.js is given a copy of the file each time', async () => {
    const getDocument = vi.fn(() => ({ promise: Promise.resolve({ numPages: 0, getPage: vi.fn() }) }))
    const data = new Uint8Array([1, 2])
    await readPdfPages({ getDocument } as unknown as PdfJsLike, data, '')
    const calls = getDocument.mock.calls as unknown as [{ data: Uint8Array; password?: string }][]
    expect(calls[0][0].data).not.toBe(data)
    expect(calls[0][0].password).toBeUndefined()
  })
})
