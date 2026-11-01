// Strips personal details from statement text on the device, before anything is sent to the AI (phase-1 §4, I-05).
// Allow-list first: only these lines go out, and only the parts named here:
//   - transaction lines: a date at the start AND an amount at the end (optionally CR);
//   - labelled header values (statement date, due date, new balance…): the label and its date/amount only;
//   - balance lines (SALDO SEBELUMNYA 5.846.117) and the summary table (its words, and lines of amounts that carry
//     thousands separators — a bare 10000001, 40111 or 081234567890 is never an amount).
// Then masks: any 13–19 character run of digits or mask characters (X, x, *, •) grouped by space, dash or dot
// (card numbers, masked or not), and a block-list of what the app knows is personal — the card's last 4 digits and
// the holder's name as printed at the top of the first page.

const MONTH = '(?:JAN|FEB|MAR|APR|MAY|MEI|JUN|JUL|AUG|AGU|AGS|SEP|OCT|OKT|NOV|DEC|DES)[A-Z]*'
const DATE = String.raw`\d{1,2}(?:[-/ ]${MONTH}|[-/]\d{1,2})(?:[-/ ]\d{2,4})?`
/** An amount as banks print it: thousands separators (or at most 3 digits), optional cents. */
const AMOUNT = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d{1,3})(?:[.,]\d{2})?`
const DATED_VALUE = String.raw`\d{1,2}[ -]${MONTH}[ -]\d{2,4}|\d{1,2}/\d{1,2}/\d{2,4}`

const TX_LINE = new RegExp(`^${DATE}\\s+(?:${DATE}\\s+)?\\S.*\\s(?:RP\\.?\\s*)?-?${AMOUNT}(?:\\s*CR)?$`, 'i')
const LABELS = [
  'TANGGAL REKENING',
  'TANGGAL JATUH TEMPO',
  'TAGIHAN BARU',
  'PEMBAYARAN MINIMUM',
  'Statement Date',
  'Payment Due Date',
  'Total Balance \\(IDR\\)',
  'Minimum Payment \\(IDR\\)',
]
const LABELLED = new RegExp(`(${LABELS.join('|')})\\s*:?\\s*(${DATED_VALUE}|(?:RP\\.?\\s*)?${AMOUNT}(?![\\d.,]))`, 'gi')
const BALANCE_LINE = new RegExp(`^(SALDO SEBELUMNYA|TAGIHAN BULAN LALU|SUB-?TOTAL|TOTAL TAGIHAN)\\s*:?\\s*((?:RP\\.?\\s*)?${AMOUNT})(\\s*CR)?$`, 'i')
const SUMMARY_WORDS = new Set(
  'TAGIHAN SEBELUMNYA PEMBAYARAN/CR PEMBAYARAN PEMBELANJAAN BIAYA ADM & BUNGA BARU KREDIT / PREVIOUS BALANCE PAYMENTS CREDITS PURCHASES FEES INTEREST NEW'.split(' '),
)
/** Amounts with thousands separators (or a plain 0), nothing else. */
const NUMBERS_LINE = /^(?:(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|0)(?:\s*CR)?\s*)+$/i
/** 13–19 digits or mask characters: one run, or a group of 4 then groups of 4–6 split by space, dash or dot. */
const CARD_NUMBER = /(?<![\w*•.,-])(?:[\dXx*•]{4}(?:[ .-][\dXx*•]{4,6}){2,3}|[\dXx*•]{13,19})(?![\w*•]|[.,-]\d)/g

/** Words of a name: never these header words. */
const NOT_NAME = new Set('LEMBAR TAGIHAN KARTU KREDIT CREDIT CARD STATEMENT REKENING BAPAK IBU SDR SDRI MR MRS MS NONA TUAN PT BANK'.split(' '))

export interface RedactOptions {
  /** Last 4 digits of the card (from the card record). */
  last4?: string
  /** Extra names to block (e.g. the holder name, when known). */
  names?: string[]
}

/** The holder's name as printed at the top of the first page: digit-free words in the first lines, minus header words. */
export function holderNameWords(firstPage: readonly string[]): string[] {
  const words = firstPage
    .slice(0, 3)
    .filter((l) => !/\d/.test(l))
    .flatMap((l) => l.toUpperCase().split(/[^A-Z]+/))
    .filter((w) => w.length >= 3 && !NOT_NAME.has(w))
  return [...new Set(words)]
}

function keep(line: string): string | null {
  const l = line.trim().replace(/\s+/g, ' ')
  if (TX_LINE.test(l)) return l
  const balance = BALANCE_LINE.exec(l)
  if (balance) return `${balance[1]} ${balance[2]}${balance[3] ?? ''}`
  const labelled = [...l.matchAll(LABELLED)].map((m) => `${m[1]}: ${m[2]}`)
  if (labelled.length) return labelled.join(' | ')
  if (NUMBERS_LINE.test(l)) return l
  const words = l.split(' ')
  if (words.length > 1 && words.every((w) => SUMMARY_WORDS.has(w.toUpperCase()))) return l
  return null
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text sent to the AI: kept lines of every page, each page under a "--- PAGE n ---" marker (0-based). */
export function redactStatement(pages: readonly (readonly string[])[], opts: RedactOptions = {}): string {
  const names = [...holderNameWords(pages[0] ?? []), ...(opts.names ?? []).flatMap((n) => n.toUpperCase().split(/[^A-Z]+/)).filter((w) => w.length >= 3)]
  const blocked = names.length ? new RegExp(`\\b(?:${names.map(escape).join('|')})\\b`, 'gi') : null
  const last4 = opts.last4 && /^\d{4}$/.test(opts.last4) ? new RegExp(`(?<![\\d.,])${opts.last4}(?![\\d.,])`, 'g') : null
  return pages
    .map((lines, i) => {
      const kept = lines.flatMap((line) => {
        let k = keep(line)
        if (k === null) return []
        k = k.replace(CARD_NUMBER, '[card]')
        if (last4) k = k.replace(last4, '[card]')
        if (blocked) k = k.replace(blocked, '[name]')
        return [k]
      })
      return [`--- PAGE ${i} ---`, ...kept].join('\n')
    })
    .join('\n')
}

/** Previous and new balance as printed, read on the device from the redacted text (to cross-check the AI). */
export function printedBalances(text: string): { prevBalance: number | null; newBalance: number | null } {
  const amount = (re: RegExp) => {
    const m = re.exec(text)
    return m ? Number(m[1].replace(/[.,]\d{2}$/, '').replace(/[.,]/g, '')) : null
  }
  return {
    prevBalance: amount(new RegExp(`^(?:SALDO SEBELUMNYA|TAGIHAN BULAN LALU) (?:RP\\.?\\s*)?(${AMOUNT})$`, 'im')),
    newBalance: amount(new RegExp(`(?:TAGIHAN BARU|Total Balance \\(IDR\\)): (?:RP\\.?\\s*)?(${AMOUNT})`, 'i')),
  }
}
