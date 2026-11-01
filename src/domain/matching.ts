import { daysBetween } from './money'
import type { Payment } from './types'

/** A hand-recorded payment and a bank payment line match within this many days. */
export const MATCH_WINDOW_DAYS = 5

/** Same card, same amount, dates within ±5 days. */
export function couldMatch(hand: Payment, line: Payment): boolean {
  return line.cardId === hand.cardId && line.amount === hand.amount && Math.abs(daysBetween(hand.date, line.date)) <= MATCH_WINDOW_DAYS
}

export interface PaymentLink {
  paymentId: string
  lineId: string
  /** Days from the hand-recorded date to the bank date. */
  days: number
}

/**
 * Links hand-recorded payments to bank payment lines (statement or Unbilled) with the same amount and a date within ±5 days.
 * Each line and each payment is used once; already-linked pairs are kept. Lines that carry their own assignments or
 * deposit are not taken (their assignments would be lost). Earlier payments pick first; the closest date wins, then the earlier line.
 */
export function matchManualPayments(payments: readonly Payment[]): PaymentLink[] {
  const used = new Set(payments.filter((p) => p.source === 'manual' && p.linkedStatementLine).map((p) => p.linkedStatementLine))
  const lines = payments.filter((p) => p.source !== 'manual' && !used.has(p.id) && p.allocations.length === 0 && p.depositOwnerId === undefined)
  const manual = payments
    .filter((p) => p.source === 'manual' && !p.linkedStatementLine)
    .sort((a, b) => a.date.localeCompare(b.date))
  const links: PaymentLink[] = []
  for (const p of manual) {
    const best = lines
      .filter((l) => !used.has(l.id) && couldMatch(p, l))
      .sort((a, b) => Math.abs(daysBetween(p.date, a.date)) - Math.abs(daysBetween(p.date, b.date)) || a.date.localeCompare(b.date))[0]
    if (best) {
      used.add(best.id)
      links.push({ paymentId: p.id, lineId: best.id, days: daysBetween(p.date, best.date) })
    }
  }
  return links
}

/** Writes links onto the hand-recorded payments (assignments unchanged). */
export function applyLinks(payments: readonly Payment[], links: readonly PaymentLink[]): Payment[] {
  return payments.map((p) => {
    const link = links.find((l) => l.paymentId === p.id)
    return link ? { ...p, linkedStatementLine: link.lineId, waiting: false } : p
  })
}

export type CreditKind = 'payment' | 'refund' | 'reversal'

/**
 * Classifies a credit (CR) line by its description. Reversal is checked first (`REVERSAL CICILAN …`), then refund,
 * then payment words. `null` = not recognised: the user must pick.
 */
export function classifyCredit(description: string): CreditKind | null {
  const d = description.toUpperCase()
  if (/\bREVERSAL\b/.test(d)) return 'reversal'
  if (/\bREFUND\b/.test(d)) return 'refund'
  if (/\b(PEMBAYARAN|PAYMENT|TRANSFER)\b/.test(d)) return 'payment'
  return null
}
