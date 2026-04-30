import Dexie, { type Table } from 'dexie'
import type {
  Owner,
  BillPeriod,
  Transaction,
  Expense,
  InstallmentPlan,
  Payment,
  PaymentAllocation,
} from './types'

interface SettingsRecord {
  key: string
  value: string
}

class CCBillDB extends Dexie {
  owners!: Table<Owner>
  periods!: Table<BillPeriod>
  transactions!: Table<Transaction>
  expenses!: Table<Expense>
  installmentPlans!: Table<InstallmentPlan>
  payments!: Table<Payment>
  paymentAllocations!: Table<PaymentAllocation>
  settings!: Table<SettingsRecord>

  constructor() {
    super('CCBillDB')
    this.version(1).stores({
      owners: '&id, name',
      periods: '&id, year, month',
      transactions: '&id, periodId, type, date, hidden',
      expenses: '&id, transactionId, ownerId, status, installmentPlanId',
      installmentPlans: '&id, ownerId, startPeriod',
      payments: '&id, periodId, date',
      paymentAllocations: '&id, paymentId, expenseId',
      settings: '&key',
    })
    // v2: adds source index on transactions, type index on periods
    this.version(2).stores({
      owners: '&id, name',
      periods: '&id, year, month, type',
      transactions: '&id, periodId, type, date, hidden, source',
      expenses: '&id, transactionId, ownerId, status, installmentPlanId',
      installmentPlans: '&id, ownerId, startPeriod',
      payments: '&id, periodId, date',
      paymentAllocations: '&id, paymentId, expenseId',
      settings: '&key',
    })
  }
}

export const db = new CCBillDB()

export function generateId(): string {
  return crypto.randomUUID()
}

export async function getSetting(key: string): Promise<string | undefined> {
  const record = await db.settings.get(key)
  return record?.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}

export async function seedDefaultOwners(): Promise<void> {
  const count = await db.owners.count()
  if (count > 0) return
  await db.owners.bulkPut([
    { id: generateId(), name: 'Wahyu', color: 'blue' },
    { id: generateId(), name: 'Wife', color: 'pink' },
    { id: generateId(), name: 'Us', color: 'purple' },
  ])
}

export async function getExpenseForTransaction(
  transactionId: string
): Promise<Expense | undefined> {
  return db.expenses.where('transactionId').equals(transactionId).first()
}

export async function getAllocatedAmount(expenseId: string): Promise<number> {
  const allocs = await db.paymentAllocations
    .where('expenseId')
    .equals(expenseId)
    .toArray()
  return allocs.reduce((sum, a) => sum + a.amount, 0)
}
