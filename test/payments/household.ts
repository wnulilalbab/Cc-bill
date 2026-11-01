// The synthetic household's BCA card up to the Nov statement, for the Payments screen tests (fictional data).
// Built with the domain functions exactly as src/domain/scenarios.test.ts does: Jul and Aug payments filled oldest
// first, Watsons paid the day after, the Sep payment on Blibli + KidZania, then the Oct installment conversion.
// Owner ids are the fixture owner names (Andi, Sari, Bima, Keluarga, Medis).
import household from '../fixtures/household.json'
import { fillOldestFirst, savePayment } from '../../src/domain/allocate'
import { convertToInstallment, type ConversionResult } from '../../src/domain/installments'
import type { Ledger, Payment } from '../../src/domain/types'
import type { NewDb } from '../../src/data/db'
import { BCA_FILES, fixtureLedger, rowId } from '../domain/builders'

export const BCA_OWNERS = household.cards.bca.owners
export const TODAY = '2026-11-01'

const base = fixtureLedger(BCA_FILES, 'bca')
const id = (file: string, description: string, amount?: number) => rowId(base, file, description, amount)

export const IDS = {
  JUL_PAY: id('bca-2026-08', 'PEMBAYARAN', 1000000),
  AUG_PAY: id('bca-2026-09', 'PEMBAYARAN', 3122682),
  WATSONS_PAY: id('bca-2026-10', 'PEMBAYARAN', 200000),
  SEP_PAY: id('bca-2026-10', 'PEMBAYARAN', 1470000),
  OCT20_LINE: id('bca-2026-11', 'PEMBAYARAN', 2000000),
  OCT30_LINE: id('bca-2026-11', 'PEMBAYARAN', 1500000),
  BLIBLI: id('bca-2026-09', 'BLIBLI'),
  KIDZANIA: id('bca-2026-09', 'KIDZANIA'),
  REVERSAL: id('bca-2026-10', 'REVERSAL CICILAN'),
  WATSONS: id('bca-2026-10', 'WATSONS'),
  INST2: id('bca-2026-11', 'CICILAN BCA KE 02 DARI 06'),
  TOKOPEDIA: id('bca-2026-11', 'TOKOPEDIA'),
}

const replace = (l: Ledger, p: Payment): Ledger => ({ ...l, payments: l.payments.map((x) => (x.id === p.id ? p : x)) })
function assignAll(l: Ledger, paymentId: string): Ledger {
  const p = l.payments.find((x) => x.id === paymentId)!
  const { draft } = fillOldestFirst(l, { paymentId, cardId: 'bca', date: p.date, amount: p.amount, ownerIds: BCA_OWNERS, multi: true, allocations: {} })
  return replace(l, savePayment(l, p, draft, null))
}

/** The BCA ledger after the Oct conversion: every payment up to Oct assigned; the two Nov lines (20 and 30 Oct) open. */
export function householdLedger(): Ledger {
  const afterAug = assignAll(assignAll(base, IDS.JUL_PAY), IDS.AUG_PAY)
  const before: Ledger = {
    ...afterAug,
    payments: afterAug.payments.map((p) =>
      p.id === IDS.WATSONS_PAY
        ? { ...p, allocations: [{ txId: IDS.WATSONS, amount: 200000 }] }
        : p.id === IDS.SEP_PAY
          ? { ...p, allocations: [{ txId: IDS.BLIBLI, amount: 1000000 }, { txId: IDS.KIDZANIA, amount: 470000 }] }
          : p,
    ),
  }
  const r = convertToInstallment(before, IDS.REVERSAL, 'plan-blibli') as ConversionResult
  return {
    ...before,
    transactions: before.transactions.map((t) => r.transactions.find((x) => x.id === t.id) ?? t),
    payments: before.payments.map((p) => r.payments.find((x) => x.id === p.id) ?? p),
    plans: [...before.plans, r.plan],
  }
}

/** The household's hand-recorded payments: 5 Sep 300.000 for Bima (never on a statement), 18 Oct 2.000.000 for Andi. */
export const handPayments = (): Payment[] =>
  household.handRecorded.payments.map((h, i) => ({
    id: ['hand-0905', 'hand-1018'][i],
    cardId: h.card,
    source: 'manual',
    date: h.date,
    amount: h.amount,
    allocations: [],
    forOwnerIds: [h.owner],
  }))

/** Writes the card, its owners and `ledger` into `db`. */
export async function seedHousehold(db: NewDb, ledger: Ledger = householdLedger()): Promise<NewDb> {
  await db.cards.put({ id: 'bca', name: household.cards.bca.name, bank: 'BCA', last4: '1234', defaultOwnerId: household.cards.bca.defaultOwner })
  await db.owners.bulkPut(BCA_OWNERS.map((name, order) => ({ id: name, cardId: 'bca', name, order }) as never))
  await db.statements.bulkPut(ledger.statements)
  await db.transactions.bulkPut(ledger.transactions)
  await db.payments.bulkPut(ledger.payments)
  await db.plans.bulkPut(ledger.plans)
  return db
}
