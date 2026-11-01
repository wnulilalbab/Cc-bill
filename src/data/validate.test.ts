import { describe, expect, it } from 'vitest'
import { MoneyError } from '../domain/money'
import type { DataTable } from './db'
import { checkRecord, RecordError } from './validate'

const BILLED = { id: 's1', cardId: 'c', kind: 'billed', statementDate: '2026-08-12', dueDate: '2026-08-28', printed: { prevBalance: 0, credits: 0, purchases: 0, feesInterest: 0, newBalance: 0 } }
const TX = { id: 't1', cardId: 'c', statementId: 's1', date: '2026-08-01', description: '', amount: -5, kind: 'refund', ownerId: 'o' }
const PAY = { id: 'p1', cardId: 'c', source: 'statement', date: '2026-08-02', amount: 10, allocations: [{ txId: 't1', amount: 10 }] }
const PLAN = { id: 'pl', cardId: 'c', ownerId: null, name: 'P', monthly: 100, total: 6, start: '2026-08' }

const ok: [DataTable, unknown][] = [
  ['cards', { id: 'c', name: 'BCA Shared', bank: 'BCA', defaultOwnerId: null }],
  ['owners', { id: 'o', cardId: 'c', name: 'Andi' }],
  ['statements', BILLED],
  ['statements', { id: 'u', cardId: 'c', kind: 'unbilled' }],
  ['transactions', TX],
  ['transactions', { ...TX, amount: -15000, kind: 'fee', signAccepted: true }],
  ['transactions', { ...TX, amount: -1, kind: 'interest', signAccepted: true }],
  ['payments', PAY],
  ['plans', PLAN],
]

const bad: [string, DataTable, unknown, string][] = [
  ['array', 'cards', [], 'cards record must be an object'],
  ['card without name', 'cards', { id: 'c', name: '', defaultOwnerId: null }, 'card c name must be a non-empty text'],
  ['card default owner', 'cards', { id: 'c', name: 'X', defaultOwnerId: 5 }, 'card c defaultOwnerId must be a text or null'],
  ['owner without card', 'owners', { id: 'o', name: 'A' }, 'owner o cardId must be a non-empty text'],
  ['owner without name', 'owners', { id: 'o', cardId: 'c' }, 'owner o name must be a non-empty text'],
  ['statement kind', 'statements', { ...BILLED, kind: 'open' }, 'statement s1 kind must be "billed" or "unbilled"'],
  ['statement date', 'statements', { ...BILLED, statementDate: 'Aug' }, 'statement s1 statementDate must be a date (YYYY-MM-DD)'],
  ['due date', 'statements', { ...BILLED, dueDate: undefined }, 'statement s1 dueDate must be a date (YYYY-MM-DD)'],
  ['printed missing', 'statements', { ...BILLED, printed: null }, 'statement s1 printed totals are missing'],
  ['printed amount', 'statements', { ...BILLED, printed: { ...BILLED.printed, newBalance: 0.5 } }, 'statement s1 printed newBalance must be an integer number of rupiah, got 0.5'],
  ['tx statement', 'transactions', { ...TX, statementId: 7 }, 'transaction t1 statementId must be a non-empty text'],
  ['tx date', 'transactions', { ...TX, date: '2026-8-1' }, 'transaction t1 date must be a date (YYYY-MM-DD)'],
  ['tx owner', 'transactions', { ...TX, ownerId: undefined }, 'transaction t1 ownerId must be a text or null'],
  ['tx Infinity', 'transactions', { ...TX, amount: Infinity }, 'transaction t1 amount must be an integer number of rupiah, got Infinity'],
  ['F-10 signAccepted on a refund', 'transactions', { ...TX, signAccepted: true }, 'transaction t1 signAccepted is only for a fee or interest row with a negative amount'],
  ['F-10 signAccepted on a positive fee', 'transactions', { ...TX, amount: 15000, kind: 'fee', signAccepted: true }, 'transaction t1 signAccepted is only for a fee or interest row with a negative amount'],
  ['F-10 signAccepted false', 'transactions', { ...TX, amount: -15000, kind: 'fee', signAccepted: false }, 'transaction t1 signAccepted is only for a fee or interest row with a negative amount'],
  ['payment source', 'payments', { ...PAY, source: 'cash' }, 'payment p1 source must be one of statement, unbilled, manual'],
  ['payment date', 'payments', { ...PAY, date: null }, 'payment p1 date must be a date (YYYY-MM-DD)'],
  ['allocation without txId', 'payments', { ...PAY, allocations: [{ amount: 1 }] }, 'payment p1 has an allocation without a txId'],
  ['allocation null', 'payments', { ...PAY, allocations: [null] }, 'payment p1 has an allocation without a txId'],
  ['negative allocation', 'payments', { ...PAY, allocations: [{ txId: 't1', amount: -1 }] }, 'payment p1 allocation to t1 is negative'],
  ['payment amount', 'payments', { ...PAY, amount: '10' }, 'payment p1 amount must be an integer number of rupiah, got 10'],
  ['plan owner', 'plans', { ...PLAN, ownerId: 1 }, 'plan pl ownerId must be a text or null'],
  ['plan months', 'plans', { ...PLAN, total: 0 }, 'plan pl total must be a whole number of months'],
]

describe('record checks', () => {
  it.each(ok)('G-06 accepts a valid %s record', (table, record) => {
    expect(() => checkRecord(table, record as never)).not.toThrow()
  })

  it.each(bad)('G-06 rejects %s', (_name, table, record, message) => {
    let error: unknown
    try {
      checkRecord(table, record as never)
    } catch (e) {
      error = e
    }
    expect(error instanceof RecordError || error instanceof MoneyError).toBe(true)
    expect((error as Error).message).toBe(message)
  })
})
