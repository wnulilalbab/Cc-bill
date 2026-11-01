// Wording and number formats for the WhatsApp share (docs/intent/phase-1.md §9; format from the prototype's
// share preview). Pure: no locale APIs, so the text is the same on every phone.
import { assertRupiah } from '../money'
import type { ISODate, Rupiah } from '../types'

export type ShareLang = 'id' | 'en'

const MONTHS: Record<ShareLang, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
}

/** Integer rupiah grouped the id-ID way: "1.234.567", "−44.631" (minus sign U+2212, as on the Bill screen). */
export function amount(n: Rupiah): string {
  assertRupiah(n)
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+$)/g, '.')
  return n < 0 ? `−${digits}` : digits
}

/** "Rp 1.234.567". */
export const rupiah = (n: Rupiah) => `Rp ${amount(n)}`

const month = (iso: string, lang: ShareLang) => MONTHS[lang][Number(iso.slice(5, 7)) - 1]

/** "28 Okt" / "28 Oct". */
export const dayMonth = (iso: ISODate, lang: ShareLang) => `${Number(iso.slice(8, 10))} ${month(iso, lang)}`

/** "1 Nov 2026". */
export const fullDate = (iso: ISODate, lang: ShareLang) => `${dayMonth(iso, lang)} ${iso.slice(0, 4)}`

/** "Okt 2026" / "Oct 2026" (a statement, by its statement date). */
export const monthYear = (iso: ISODate, lang: ShareLang) => `${month(iso, lang)} ${iso.slice(0, 4)}`

/** Every piece of wording the message uses, per language. */
export const WORDS = {
  id: {
    bill: 'Tagihan',
    unbilled: 'Belum ditagih',
    due: 'jatuh tempo',
    asOf: 'Per',
    draftLabel: 'SEMENTARA',
    draftNote: 'angka bisa berubah',
    everyone: 'Semua',
    paidShort: 'Lunas ✓',
    paid: '✓ lunas',
    paidRow: 'lunas',
    refund: 'refund',
    charges: 'Tagihan',
    alreadyPaid: 'Sudah dibayar',
    olderUnpaid: 'Sisa',
    olderCredit: 'Kredit',
    credit: 'Kredit refund (mengurangi tagihan berikutnya)',
    deposit: 'Deposit tersisa',
    nothing: 'Tidak ada transaksi di tagihan ini.',
    noOwner: 'Tanpa pemilik',
    total: 'Total semua',
    installment: 'cicilan',
  },
  en: {
    bill: 'Bill',
    unbilled: 'Unbilled',
    due: 'due',
    asOf: 'As of',
    draftLabel: 'PROVISIONAL',
    draftNote: 'numbers may change',
    everyone: 'Everyone',
    paidShort: 'Paid ✓',
    paid: '✓ paid',
    paidRow: 'paid',
    refund: 'refund',
    charges: 'Charges',
    alreadyPaid: 'Already paid',
    olderUnpaid: 'Unpaid',
    olderCredit: 'Credit',
    credit: 'Refund credit (lowers the next bill)',
    deposit: 'Deposit waiting',
    nothing: 'No transactions on this bill.',
    noOwner: 'No owner',
    total: 'Total, everyone',
    installment: 'installment',
  },
} as const satisfies Record<ShareLang, Record<string, string>>

/**
 * Masks anything that looks like a full card number (13–19 digits, spaces or dashes allowed between them) down to
 * its last 4: "4556 7712 3456 1234" → "••••1234". Amounts are grouped with dots, so they never match.
 */
export function maskCardNumbers(text: string): string {
  return text.replace(/\d(?:[ -]?\d){12,18}/g, (m) => `••••${m.replace(/\D/g, '').slice(-4)}`)
}
