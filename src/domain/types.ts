// Money-core domain types. Pure data: no React, no Dexie.
// All money is integer rupiah. All dates are ISO calendar dates (YYYY-MM-DD).

export type ISODate = string
/** Integer rupiah. Never a float. */
export type Rupiah = number

export interface Card {
  id: string
  name: string
  bank: string
  last4?: string
  /** Day of month the bank closes the statement. */
  statementDay?: number
  /** Owner that gets fees, interest and rows nothing else matched. `null` = "None". */
  defaultOwnerId: string | null
}

export interface Owner {
  id: string
  cardId: string
  name: string
  /** Hidden from tagging/assigning pickers; history kept. */
  archived?: boolean
}

/** What the bank printed at the top of a statement. */
export interface PrintedTotals {
  prevBalance: Rupiah
  credits: Rupiah
  purchases: Rupiah
  feesInterest: Rupiah
  newBalance: Rupiah
  minPayment?: Rupiah
}

export interface BilledStatement {
  id: string
  cardId: string
  kind: 'billed'
  statementDate: ISODate
  dueDate: ISODate
  printed: PrintedTotals
}

/** The single Unbilled bucket of a card. */
export interface UnbilledStatement {
  id: string
  cardId: string
  kind: 'unbilled'
}

export type Statement = BilledStatement | UnbilledStatement

export type TxKind = 'purchase' | 'installment' | 'fee' | 'interest' | 'refund' | 'reversal'

/**
 * How a row got its owner (shown as You / Rule / Auto / AI / Card default / Plan). Unset on rows from before tagging
 * existed (e.g. migrated), which count as not set by hand.
 */
export type TagSource = 'manual' | 'rule' | 'auto' | 'ai' | 'default' | 'plan'

export interface Transaction {
  id: string
  cardId: string
  /** Billed statement or the card's Unbilled bucket. */
  statementId: string
  date: ISODate
  description: string
  /** Signed integer rupiah: charges > 0, refunds and reversals < 0. */
  amount: Rupiah
  kind: TxKind
  ownerId: string | null
  /** Yellow "Check" dot. */
  check?: boolean
  /** How the owner was chosen (src/domain/tagging). */
  tagSource?: TagSource
  /** A purchase that was moved to installment: not counted. */
  cancelled?: boolean
  /** On a reversal: id of the transaction it cancels. */
  reverses?: string
  /** On an installment: the plan it belongs to. */
  planId?: string
  installment?: { n: number; of: number }
  /** Unbilled row the user chose to "Keep waiting" for although it is older than the latest statement. */
  keepWaiting?: boolean
}

export interface Allocation {
  txId: string
  amount: Rupiah
}

/**
 * - `statement`: a payment line printed on a billed statement (`statementId`).
 * - `unbilled`: a payment line from an Unbilled screenshot (`statementId` = the Unbilled bucket).
 * - `manual`: recorded by hand.
 */
export type PaymentSource = 'statement' | 'unbilled' | 'manual'

export interface Payment {
  id: string
  cardId: string
  source: PaymentSource
  date: ISODate
  /** Positive integer rupiah. */
  amount: Rupiah
  /** Where a bank line is printed. Unset for manual payments. */
  statementId?: string
  /** Manual payments only: id of the bank payment line it was matched to (counted once). */
  linkedStatementLine?: string
  allocations: Allocation[]
  /** Leftover kept as this owner's deposit. Unset = "Decide later". */
  depositOwnerId?: string
  /** Manual payment missing from a statement: the user chose "Keep waiting". */
  waiting?: boolean
  /** Who the payment is for, used to pre-select people on the assign page. */
  forOwnerIds?: string[]
  description?: string
}

export interface InstallmentPlan {
  id: string
  cardId: string
  ownerId: string | null
  name: string
  monthly: Rupiah
  /** Number of months. */
  total: number
  /** Month (YYYY-MM) of the statement that carries installment 1. */
  start: string
}

/** Everything the money functions read. */
export interface Ledger {
  statements: Statement[]
  transactions: Transaction[]
  payments: Payment[]
  plans: InstallmentPlan[]
}
