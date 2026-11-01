// Statement month (and date, when it is there) from the bank's file name (phase-1 §4, I-14).
//   CC_eBilling2026-10-11.pdf  → 11 Oct 2026 (Mandiri)
//   22965532_OCT_2026.pdf      → Oct 2026 (BCA)

export interface FileMonth {
  /** YYYY-MM */
  month: string
  /** YYYY-MM-DD when the file name carries the day. */
  date?: string
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MONTHS_ID: Record<string, number> = { MEI: 5, AGU: 8, AGS: 8, OKT: 10, DES: 12 }
const pad = (n: number) => String(n).padStart(2, '0')

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function monthFromFileName(name: string): FileMonth | null {
  const base = name.replace(/^.*[\\/]/, '')
  const full = /(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:\D|$)/.exec(base)
  if (full) {
    const [y, m, d] = [Number(full[1]), Number(full[2]), Number(full[3])]
    if (validDate(y, m, d)) return { month: `${y}-${pad(m)}`, date: `${y}-${pad(m)}-${pad(d)}` }
  }
  const named = /(?:^|[^A-Z])([A-Z]{3})[A-Z]*[-_ .]?(20\d{2})(?:\D|$)/i.exec(base)
  if (named) {
    const key = named[1].toUpperCase()
    const m = MONTHS.indexOf(key) + 1 || MONTHS_ID[key]
    if (m) return { month: `${named[2]}-${pad(m)}` }
  }
  const ym = /(?:^|\D)(20\d{2})[-_.](\d{2})(?:\D|$)/.exec(base)
  if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) return { month: `${ym[1]}-${ym[2]}` }
  return null
}
