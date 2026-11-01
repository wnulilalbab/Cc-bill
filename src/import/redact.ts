// Strips personal details from statement text on the device, before anything is sent to the AI (phase-1 §4).
// Allow-list, not block-list: only transaction lines, the labelled dates and totals, and the summary table go out.
// Name, address, customer number and card number are on lines that match none of these, and any card-number-like
// sequence left in a kept line is masked.

const DATE_LINE = /^\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3,9})(?:[-/ ]\d{2,4})?\s+\S/
const VALUE = String.raw`(?:RP\.?\s*)?(?:\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}|\d[\d.,]*)`
/** Header labels whose value (a date or an amount) is needed; the rest of their line is dropped. */
const LABELS = [
  'TANGGAL REKENING',
  'TANGGAL JATUH TEMPO',
  'TAGIHAN BARU',
  'PEMBAYARAN MINIMUM',
  'BATAS KREDIT',
  'Statement Date',
  'Payment Due Date',
  'Total Balance \\(IDR\\)',
  'Minimum Payment \\(IDR\\)',
]
const LABELLED = new RegExp(`(${LABELS.join('|')})\\s*:?\\s*(${VALUE})`, 'gi')
const BALANCE_LINE = new RegExp(`^(SALDO SEBELUMNYA|TAGIHAN BULAN LALU|SUB-?TOTAL|TOTAL TAGIHAN|TOTAL)\\s*:?\\s*(${VALUE})(\\s*CR)?$`, 'i')
const SUMMARY_WORDS = new Set(
  'TAGIHAN SEBELUMNYA PEMBAYARAN/CR PEMBAYARAN PEMBELANJAAN BIAYA ADM & BUNGA BARU KREDIT / PREVIOUS BALANCE PAYMENTS CREDITS PURCHASES FEES INTEREST NEW'.split(' '),
)
const NUMBERS_LINE = /^(?:[\d.,]+\s*(?:CR)?\s*)+$/i
/** 13–19 digit card numbers, masked or not: "4556-77XX-XXXX-1234", "5299 12** **** 4321". */
const CARD_NUMBER = /\b\d{4}[ -]?[\dX*]{4}[ -]?[\dX*]{4}[ -]?\d{1,4}\b/gi

function keep(line: string): string | null {
  const l = line.trim()
  if (DATE_LINE.test(l)) return l
  const balance = BALANCE_LINE.exec(l)
  if (balance) return `${balance[1]} ${balance[2]}${balance[3] ?? ''}`
  const labelled = [...l.matchAll(LABELLED)].map((m) => `${m[1]}: ${m[2]}`)
  if (labelled.length) return labelled.join(' | ')
  if (NUMBERS_LINE.test(l)) return l
  const words = l.split(/\s+/)
  if (words.length > 1 && words.every((w) => SUMMARY_WORDS.has(w.toUpperCase()))) return l
  return null
}

/** The text sent to the AI: kept lines of every page, each page under a "--- PAGE n ---" marker (0-based). */
export function redactStatement(pages: readonly (readonly string[])[]): string {
  return pages
    .map((lines, i) => {
      const kept = lines.flatMap((line) => {
        const k = keep(line)
        return k === null ? [] : [k.replace(CARD_NUMBER, '[card]')]
      })
      return [`--- PAGE ${i} ---`, ...kept].join('\n')
    })
    .join('\n')
}
