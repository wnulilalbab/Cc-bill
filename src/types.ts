export type TransactionType =
  | 'purchase'
  | 'installment'
  | 'payment'
  | 'refund'
  | 'reversal'
  | 'fee'
  | 'interest'

export type ExpenseStatus = 'unpaid' | 'partial' | 'paid'

export type OwnerColor =
  | 'blue'
  | 'pink'
  | 'purple'
  | 'green'
  | 'orange'
  | 'teal'
  | 'red'
  | 'yellow'

export interface Owner {
  id: string
  name: string
  color: OwnerColor
}

export interface BillPeriod {
  id: string
  label: string      // "Feb 2026"
  month: number      // 1–12
  year: number
  dueDate?: string   // "2026-02-28"
  importedAt: string
}

export interface Transaction {
  id: string
  periodId: string
  date: string        // "YYYY-MM-DD"
  description: string
  amount: number      // positive = charge, negative = credit/payment
  type: TransactionType
  hidden: boolean
  raw?: string
}

export interface Expense {
  id: string
  transactionId: string
  label: string
  ownerId: string
  installmentPlanId?: string
  status: ExpenseStatus
}

export interface InstallmentPlan {
  id: string
  name: string
  originalAmount: number
  totalMonths: number
  monthlyAmount: number
  startPeriod: string  // "YYYY-MM"
  ownerId: string
  notes?: string
}

export interface Payment {
  id: string
  periodId: string
  date: string
  amount: number
  note: string
}

export interface PaymentAllocation {
  id: string
  paymentId: string
  expenseId: string
  amount: number
}

export interface ParsedTransaction {
  date: string
  description: string
  amount: number
  type: TransactionType
}
