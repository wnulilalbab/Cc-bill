// Test builders for the money core. Synthetic data only.
import bca07 from '../fixtures/statements/bca-2026-07.expected.json'
import bca08 from '../fixtures/statements/bca-2026-08.expected.json'
import bca09 from '../fixtures/statements/bca-2026-09.expected.json'
import bca10 from '../fixtures/statements/bca-2026-10.expected.json'
import bca11 from '../fixtures/statements/bca-2026-11.expected.json'
import mandiri10 from '../fixtures/statements/mandiri-2026-10.expected.json'
import mandiri11 from '../fixtures/statements/mandiri-2026-11.expected.json'
import type { BilledStatement, Ledger, Payment, PrintedTotals, Transaction, TxKind, UnbilledStatement } from '../../src/domain/types'

const ZERO: PrintedTotals = { prevBalance: 0, credits: 0, purchases: 0, feesInterest: 0, newBalance: 0 }

export const billed = (id: string, statementDate: string, dueDate: string, cardId = 'c'): BilledStatement => ({
  id, cardId, kind: 'billed', statementDate, dueDate, printed: ZERO,
})
export const unbilled = (id = 'unb', cardId = 'c'): UnbilledStatement => ({ id, cardId, kind: 'unbilled' })

export const tx = (id: string, statementId: string, date: string, amount: number, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id, cardId: 'c', statementId, date, description: id.toUpperCase(), amount, kind: amount < 0 ? 'refund' : 'purchase', ownerId, ...extra,
})

export const pay = (id: string, date: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id, cardId: 'c', source: 'manual', date, amount, allocations: [], ...extra,
})

export const ledger = (l: Partial<Ledger>): Ledger => ({ statements: [], transactions: [], payments: [], plans: [], ...l })

/** Three monthly statements S−1, S, S+1 on card `c`, closing on the 12th, due on the 28th, plus Unbilled. */
export const months = () => [
  billed('aug', '2026-08-12', '2026-08-28'),
  billed('sep', '2026-09-12', '2026-09-28'),
  billed('oct', '2026-10-12', '2026-10-28'),
  unbilled(),
]

interface ExpectedRow { txDate: string; description: string; amount: number; kind: string; expectedOwner: string | null; needsCheck?: boolean; installment?: { n: number; of: number } }
interface Expected { file: string; card: string; statementDate: string; dueDate: string; printed: PrintedTotals; rows: ExpectedRow[] }

export const BCA_FILES = [bca07, bca08, bca09, bca10, bca11] as Expected[]
export const MANDIRI_FILES = [mandiri10, mandiri11] as Expected[]

export function statementFrom(e: Expected): BilledStatement {
  return { id: e.file, cardId: e.card, kind: 'billed', statementDate: e.statementDate, dueDate: e.dueDate, printed: e.printed }
}

/** Ledger built from fixture expected files: rows → transactions (owner = expected owner), payment rows → bank payments. */
export function fixtureLedger(files: Expected[], cardId: string): Ledger {
  const statements = [...files.map(statementFrom), unbilled(`${cardId}-unb`, cardId)]
  const transactions: Transaction[] = []
  const payments: Payment[] = []
  for (const e of files) {
    e.rows.forEach((r, i) => {
      const id = `${e.file}#${i}`
      if (r.kind === 'payment') {
        payments.push({ id, cardId, source: 'statement', statementId: e.file, date: r.txDate, amount: -r.amount, allocations: [], description: r.description })
      } else {
        transactions.push({
          id, cardId, statementId: e.file, date: r.txDate, description: r.description, amount: r.amount, kind: r.kind as TxKind,
          ownerId: r.expectedOwner, ...(r.needsCheck ? { check: true } : {}), ...(r.installment ? { installment: { n: r.installment.n, of: r.installment.of } } : {}),
        })
      }
    })
  }
  return { statements, transactions, payments, plans: [] }
}

/** Finds the fixture row id by file and description prefix (and amount when several match). */
export function rowId(l: Ledger, file: string, description: string, amount?: number): string {
  const all = [...l.transactions, ...l.payments.map((p) => ({ ...p, statementId: p.statementId, description: p.description ?? '', amount: -p.amount }))]
  const hits = all.filter((t) => t.statementId === file && t.description.startsWith(description) && (amount === undefined || Math.abs(t.amount) === amount))
  if (hits.length !== 1) throw new Error(`rowId ${file} ${description} ${amount}: ${hits.length} matches`)
  return hits[0].id
}
