import type { Rupiah } from './types'

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

/** Throws unless `n` is an integer number of rupiah. Returns `n`. */
export function assertRupiah(n: Rupiah, what = 'amount'): Rupiah {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} must be an integer number of rupiah, got ${n}`)
  return n
}

export function sum(values: readonly Rupiah[]): Rupiah {
  let total = 0
  for (const v of values) total += v
  return total
}

const CREDIT_KINDS = ['payment', 'refund', 'reversal']

/** True when a row's sign contradicts its kind: a credit (payment, refund, reversal) that is positive, or a charge that is negative. */
export function signContradicts(kind: string, amount: Rupiah): boolean {
  return CREDIT_KINDS.includes(kind) ? amount > 0 : amount < 0
}

/** A fee or interest row with a negative amount is a rebate: its contradicting sign may be accepted as valid. */
export function canAcceptSign(kind: string, amount: Rupiah): boolean {
  return (kind === 'fee' || kind === 'interest') && amount < 0
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Months since year 0 for a YYYY-MM or YYYY-MM-DD string. */
export function monthIndex(isoDateOrMonth: string): number {
  return Number(isoDateOrMonth.slice(0, 4)) * 12 + Number(isoDateOrMonth.slice(5, 7))
}
