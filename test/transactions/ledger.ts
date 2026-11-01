// A small synthetic ledger for the Transactions tests (fictional household, made-up amounts).
// Card "BCA Keluarga" (owners Andi, Sari, archived Bima; default Andi) with Sep and Oct 2026 statements and Unbilled,
// card "Mandiri Pribadi" (owner Andi) with Unbilled only.
import type { NewDb } from '../../src/data/db'
import type { BilledStatement, Payment, PrintedTotals, Transaction } from '../../src/domain/types'

export const ZERO: PrintedTotals = { prevBalance: 0, credits: 0, purchases: 0, feesInterest: 0, newBalance: 0 }

export const SEP: BilledStatement = { id: 'bca-sep', cardId: 'bca', kind: 'billed', statementDate: '2026-09-12', dueDate: '2026-09-28', printed: ZERO }
export const OCT: BilledStatement = { id: 'bca-oct', cardId: 'bca', kind: 'billed', statementDate: '2026-10-12', dueDate: '2026-10-28', printed: ZERO }
export const UNB = 'bca-unbilled'

export const tx = (id: string, statementId: string, date: string, description: string, amount: number, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  cardId: 'bca',
  statementId,
  date,
  description,
  amount,
  kind: amount < 0 ? 'refund' : 'purchase',
  ownerId,
  tagSource: 'rule',
  ...extra,
})

export const pay = (id: string, date: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id,
  cardId: 'bca',
  source: 'manual',
  date,
  amount,
  allocations: [],
  ...extra,
})

/** Cards, owners and statements (no rows). */
export async function seedCards(db: NewDb): Promise<NewDb> {
  await db.cards.bulkPut([
    { id: 'bca', name: 'BCA Keluarga', bank: 'BCA', last4: '1234', defaultOwnerId: 'andi' },
    { id: 'mdr', name: 'Mandiri Pribadi', bank: 'Mandiri', defaultOwnerId: 'mdr-andi' },
  ] as never)
  await db.owners.bulkPut([
    { id: 'andi', cardId: 'bca', name: 'Andi', order: 0 },
    { id: 'sari', cardId: 'bca', name: 'Sari', order: 1 },
    { id: 'bima', cardId: 'bca', name: 'Bima', order: 2, archived: true },
    { id: 'mdr-andi', cardId: 'mdr', name: 'Andi', order: 0 },
  ] as never)
  await db.statements.bulkPut([SEP, OCT, { id: UNB, cardId: 'bca', kind: 'unbilled' }, { id: 'mdr-unbilled', cardId: 'mdr', kind: 'unbilled' }])
  return db
}

/**
 * X-05/X-06: Andi's 300.000 charge on Oct is paid by Andi's 500.000 payment (15 Oct), whose 200.000 leftover is kept
 * as Andi's deposit; the deposit pays Andi's 150.000 Unbilled charge (20 Oct), 50.000 waiting.
 * Sari's 120.000 charge on Oct is paid by a 120.000 bank payment line printed on Oct, with no deposit (5 Oct).
 */
export async function seedPaidRows(db: NewDb): Promise<NewDb> {
  await seedCards(db)
  await db.transactions.bulkPut([
    tx('t-ikea', OCT.id, '2026-10-03', 'IKEA ALAM SUTERA', 300_000, 'andi'),
    tx('t-later', UNB, '2026-10-20', 'GRAB* A-7XK2', 150_000, 'andi'),
    tx('t-books', OCT.id, '2026-10-02', 'GRAMEDIA MATRAMAN', 120_000, 'sari', { tagSource: 'manual' }),
  ])
  await db.payments.bulkPut([
    pay('p-andi', '2026-10-15', 500_000, { allocations: [{ txId: 't-ikea', amount: 300_000 }], depositOwnerId: 'andi', forOwnerIds: ['andi'] }),
    pay('p-sari', '2026-10-05', 120_000, { source: 'statement', statementId: OCT.id, allocations: [{ txId: 't-books', amount: 120_000 }], forOwnerIds: ['sari'] }),
  ])
  return db
}
