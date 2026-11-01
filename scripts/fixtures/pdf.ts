import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib'
import { household, isCredit, PASSWORD, printedTotals, type Line, type Printed, type Statement } from './data'

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES']
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER']

export const idr = (n: number) => Math.round(n).toLocaleString('id-ID') // 1.900.000
export const idrMandiri = (n: number) => Math.round(n).toLocaleString('en-US') + '.00' // 1,900,000.00
export const bcaDate = (iso: string) => `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}` // 15-JUN
export const bcaLongDate = (iso: string) => `${+iso.slice(8, 10)} ${MON_LONG[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
export const mandiriDate = (iso: string) => `${iso.slice(8, 10)}-${MON_EN[+iso.slice(5, 7) - 1]}-${iso.slice(2, 4)}` // 30-Sep-26

const A4: [number, number] = [595, 842]
const ROWS_PER_PAGE = 8 // small on purpose so longer statements split their table across pages

interface Ctx { doc: PDFDocument; font: PDFFont; bold: PDFFont }

function text(page: PDFPage, ctx: Ctx, s: string, x: number, y: number, size = 8, bold = false) {
  page.drawText(s, { x, y, size, font: bold ? ctx.bold : ctx.font })
}
function right(page: PDFPage, ctx: Ctx, s: string, xRight: number, y: number, size = 8, bold = false) {
  const f = bold ? ctx.bold : ctx.font
  page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f })
}

async function newDoc(): Promise<Ctx> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
}

function pages<T>(rows: T[]): T[][] {
  if (rows.length === 0) return [[]]
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) out.push(rows.slice(i, i + ROWS_PER_PAGE))
  return out
}

export async function renderBca(st: Statement, lines: Line[] = st.lines, printed: Printed = printedTotals(st.prevBalance, st.lines)): Promise<Uint8Array> {
  const ctx = await newDoc()
  const card = household.cards.bca
  const chunks = pages(lines)
  chunks.forEach((chunk, pi) => {
    const p = ctx.doc.addPage(A4)
    let y = 800
    text(p, ctx, 'REKENING KARTU KREDIT', 380, y, 10, true)
    text(p, ctx, household.holder, 40, y, 9, true)
    y -= 14
    household.address.forEach((a, i) => text(p, ctx, a, 40, y - i * 11))
    const kv: [string, string][] = [
      ['NOMOR CUSTOMER', card.customerNo],
      ['TANGGAL REKENING', bcaLongDate(st.statementDate)],
      ['TANGGAL JATUH TEMPO', bcaLongDate(st.dueDate)],
      ['TAGIHAN BARU', 'RP ' + idr(printed.newBalance)],
      ['PEMBAYARAN MINIMUM', 'RP ' + idr(printed.minPayment)],
    ]
    kv.forEach(([k, v], i) => { text(p, ctx, k, 330, y - i * 11); text(p, ctx, ': ' + v, 450, y - i * 11) })
    y -= 70
    text(p, ctx, 'TANGGAL TRANSAKSI', 40, y, 7, true)
    text(p, ctx, 'TANGGAL PEMBUKUAN', 110, y, 7, true)
    text(p, ctx, 'KETERANGAN', 190, y, 7, true)
    right(p, ctx, 'JUMLAH (RP)', 555, y, 7, true)
    y -= 16
    if (pi === 0) {
      text(p, ctx, 'SALDO SEBELUMNYA', 190, y)
      right(p, ctx, idr(printed.prevBalance), 555, y)
      y -= 13
      text(p, ctx, `${card.masked}   ${household.holder}`, 190, y, 7)
      y -= 14
    }
    for (const l of chunk) {
      text(p, ctx, bcaDate(l.txDate), 40, y)
      text(p, ctx, bcaDate(l.postDate), 110, y)
      text(p, ctx, l.description, 190, y)
      right(p, ctx, idr(l.amount) + (isCredit(l) ? ' CR' : ''), 555, y)
      y -= 13
    }
    if (pi === chunks.length - 1) {
      y -= 20
      const cols: [string, number][] = [
        ['TAGIHAN SEBELUMNYA', printed.prevBalance],
        ['PEMBAYARAN/CR', printed.credits],
        ['PEMBELANJAAN', printed.purchases],
        ['BIAYA ADM & BUNGA', printed.feesInterest],
        ['TAGIHAN BARU', printed.newBalance],
      ]
      cols.forEach(([k, v], i) => { text(p, ctx, k, 40 + i * 105, y, 7, true); text(p, ctx, idr(v), 40 + i * 105, y - 12) })
    }
    right(p, ctx, `HALAMAN ${pi + 1} DARI ${chunks.length}`, 555, 30, 7)
  })
  return ctx.doc.save({ useObjectStreams: false })
}

export async function renderMandiri(st: Statement, opts: { lock: boolean }): Promise<Uint8Array> {
  const ctx = await newDoc()
  const card = household.cards.mandiri
  const printed = printedTotals(st.prevBalance, st.lines)
  const chunks = pages(st.lines)
  chunks.forEach((chunk, pi) => {
    const p = ctx.doc.addPage(A4)
    let y = 800
    text(p, ctx, 'Lembar Tagihan Kartu Kredit / Credit Card Statement', 40, y, 10, true)
    y -= 20
    text(p, ctx, 'BAPAK ' + household.holder, 40, y, 9, true)
    household.address.forEach((a, i) => text(p, ctx, a, 40, y - 12 - i * 11))
    y -= 60
    const kv: [string, string][] = [
      ['Tanggal Cetak Tagihan / Statement Date', mandiriDate(st.statementDate)],
      ['Tanggal Jatuh Tempo / Payment Due Date', mandiriDate(st.dueDate)],
      ['Nomor Kartu / Card Number', card.masked],
      ['Total Tagihan / Total Balance (IDR)', idrMandiri(printed.newBalance)],
      ['Pembayaran Minimum / Minimum Payment (IDR)', idrMandiri(printed.minPayment)],
    ]
    kv.forEach(([k, v], i) => { text(p, ctx, k, 40, y - i * 12); text(p, ctx, v, 300, y - i * 12, 8, true) })
    y -= 74
    text(p, ctx, 'Tanggal Transaksi', 40, y, 7, true)
    text(p, ctx, 'Tanggal Pembukuan', 120, y, 7, true)
    text(p, ctx, 'Keterangan / Description', 205, y, 7, true)
    right(p, ctx, 'Jumlah / Amount (IDR)', 555, y, 7, true)
    y -= 16
    if (pi === 0) {
      text(p, ctx, 'Tagihan Bulan Lalu', 205, y)
      right(p, ctx, idrMandiri(printed.prevBalance), 555, y)
      y -= 13
    }
    for (const l of chunk) {
      text(p, ctx, mandiriDate(l.txDate), 40, y)
      text(p, ctx, mandiriDate(l.postDate), 120, y)
      text(p, ctx, l.description, 205, y)
      right(p, ctx, idrMandiri(l.amount) + (isCredit(l) ? ' CR' : ''), 555, y)
      y -= 13
    }
    if (pi === chunks.length - 1) {
      y -= 6
      text(p, ctx, 'SUB-TOTAL', 205, y, 8, true)
      right(p, ctx, idrMandiri(printed.newBalance), 555, y, 8, true)
    }
    right(p, ctx, `Hal / Page ${pi + 1} of ${chunks.length}`, 555, 30, 7)
  })
  if (opts.lock) ctx.doc.encrypt({ userPassword: PASSWORD, ownerPassword: 'owner-' + PASSWORD, permissions: {} })
  return ctx.doc.save({ useObjectStreams: false })
}
