import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { fixture, seedOldDb, uniqueName } from '../../test/data/oldDb'
import { fingerprint, MigrationError, oldBackupJson, parseOldBackup, readOldData } from './old'

describe('parseOldBackup', () => {
  it('G-01 accepts the synthetic old-format backup, as an object or as JSON text', () => {
    const data = fixture()
    expect(parseOldBackup(data).transactions).toHaveLength(299)
    expect(parseOldBackup(JSON.stringify(data))).toEqual(parseOldBackup(data))
  })

  const broken = (change: (d: Record<string, unknown[]>) => void) => {
    const d = fixture() as unknown as Record<string, unknown[]>
    change(d)
    return () => parseOldBackup(d)
  }
  const row = (d: Record<string, unknown[]>, table: string, i = 0) => d[table][i] as Record<string, unknown>

  it.each([
    ['not JSON', () => parseOldBackup('{oops'), 'The backup is not valid JSON.'],
    ['not an object', () => parseOldBackup('[1,2]'), 'The backup is not a CC Bill backup (expected a JSON object).'],
    ['null', () => parseOldBackup(null), 'The backup is not a CC Bill backup (expected a JSON object).'],
    ['missing list', broken((d) => delete d.expenses), 'The backup is missing the "expenses" list.'],
    ['row not a record', broken((d) => (d.owners[0] = 'x')), 'An owner in the backup is not a record (owners[0]).'],
    ['non-integer amount', broken((d) => (row(d, 'transactions', 3).amount = 10.5)), 'The amount of a transaction must be an integer number of rupiah, got number 10.5 (transactions[3].amount).'],
    ['bad date', broken((d) => (row(d, 'transactions').date = '10/01/2026')), 'The date of a transaction must be a date (YYYY-MM-DD), got string "10/01/2026" (transactions[0].date).'],
    ['bad type', broken((d) => (row(d, 'transactions').type = 'gift')), 'The type of a transaction must be one of purchase, installment, payment, refund, reversal, fee, interest, got string "gift" (transactions[0].type).'],
    ['bad hidden', broken((d) => (row(d, 'transactions').hidden = 'no')), 'The hidden flag of a transaction must be true or false, got string "no" (transactions[0].hidden).'],
    ['empty id', broken((d) => (row(d, 'owners').id = '')), 'The id of an owner must be a non-empty text, got string "" (owners[0].id).'],
    ['bad month', broken((d) => (row(d, 'installmentPlans').startPeriod = '2026-7')), 'The start month of an installment plan must be a month (YYYY-MM), got string "2026-7" (installmentPlans[0].startPeriod).'],
    ['plan of 0 months', broken((d) => (row(d, 'installmentPlans').totalMonths = 0)), 'The number of months of an installment plan must be a whole number of months (1 or more), got number 0 (installmentPlans[0].totalMonths).'],
    ['plan of 2.5 months', broken((d) => (row(d, 'installmentPlans').totalMonths = 2.5)), 'The number of months of an installment plan must be a whole number of months (1 or more), got number 2.5 (installmentPlans[0].totalMonths).'],
    ['negative count', broken((d) => (row(d, 'periods').month = -1)), 'The month of a statement must be a whole number, got number -1 (periods[0].month).'],
    ['bad due date', broken((d) => (row(d, 'periods').dueDate = 'soon')), 'The due date of a statement must be a date (YYYY-MM-DD), got string "soon" (periods[0].dueDate).'],
    ['duplicate id', broken((d) => (row(d, 'owners', 1).id = 'own-0')), 'Two rows of the same list have the same id (owners, id "own-0").'],
    ['dangling period', broken((d) => (row(d, 'transactions').periodId = 'per-x')), 'A transaction points to a statement that is not in the backup (transaction tx-0001, statement per-x).'],
    ['positive payment line', broken((d) => (row(d, 'transactions', 45).amount = 5)), 'A bank payment line has an amount that is not negative, got 5 (transaction tx-0046).'],
    ['non-positive manual payment', broken((d) => (d.payments = [{ id: 'm', periodId: 'per-2026-01', date: '2026-01-01', amount: 0 }])), 'A payment recorded by hand must have a positive amount, got 0 (payment m).'],
    ['note not a text', broken((d) => (d.payments = [{ id: 'm', periodId: 'per-2026-01', date: '2026-01-01', amount: 5, note: 7 }])), 'The note of a payment recorded by hand must be a text, got number 7 (payments[0].note).'],
    ['amount is a list', broken((d) => (row(d, 'transactions').amount = [1, 2])), 'The amount of a transaction must be an integer number of rupiah, got a list of 2 (transactions[0].amount).'],
    ['amount is an object', broken((d) => (row(d, 'transactions').amount = { a: 1 })), 'The amount of a transaction must be an integer number of rupiah, got an object (transactions[0].amount).'],
    ['amount is null', broken((d) => (row(d, 'transactions').amount = null)), 'The amount of a transaction must be an integer number of rupiah, got null (transactions[0].amount).'],
    ['long text', broken((d) => (row(d, 'transactions').amount = 'x'.repeat(100))), `The amount of a transaction must be an integer number of rupiah, got string "${'x'.repeat(39)}… (transactions[0].amount).`],
    ['negative assignment', broken((d) => (row(d, 'paymentAllocations').amount = -1)), 'A payment assignment has a negative amount, got -1 (assignment al-0001).'],
  ])('G-01 rejects a malformed backup (%s) with a clear error', (_name, run, message) => {
    expect(run).toThrow(MigrationError)
    expect(run).toThrow(message)
  })
})

describe('deeply nested input', () => {
  const deep = () => {
    let v: unknown[] = []
    for (let i = 0; i < 200_000; i++) v = [v]
    return v
  }

  it('G-01 a 200k-deep value in a checked field is described without serialising it', () => {
    const d = fixture() as unknown as Record<string, Record<string, unknown>[]>
    d.transactions[0].amount = deep()
    expect(() => parseOldBackup(d)).toThrow('The amount of a transaction must be an integer number of rupiah, got a list of 1 (transactions[0].amount).')
  })

  it('G-01 a 200k-deep value anywhere else is rejected as a MigrationError, not a RangeError', () => {
    const d = fixture() as unknown as Record<string, Record<string, unknown>[]>
    d.transactions[0].extra = deep()
    expect(() => parseOldBackup(d)).toThrow(MigrationError)
    expect(() => parseOldBackup(d)).toThrow('The backup could not be read (RangeError: it may be damaged or far too deeply nested).')
  })

  it('G-01 a 200k-deep JSON text is rejected as a MigrationError', () => {
    const text = '['.repeat(200_000) + ']'.repeat(200_000)
    expect(() => parseOldBackup(text)).toThrow(MigrationError)
  })

  it('G-01 accepts empty descriptions and notes, and a missing note', () => {
    const d = fixture()
    d.transactions[0].description = ''
    d.payments = [{ id: 'm', periodId: 'per-2026-01', date: '2026-01-01', amount: 5, note: '' }, { id: 'm2', periodId: 'per-2026-01', date: '2026-01-01', amount: 5 } as never]
    expect(parseOldBackup(d).transactions[0].description).toBe('')
  })
})

describe('reading the old database', () => {
  it('G-01 returns null without creating a database when there is none', async () => {
    const name = uniqueName('CCBillDB')
    expect(await readOldData(name)).toBeNull()
    expect(await Dexie.exists(name)).toBe(false)
  })

  it('G-01 reads every old table, and tolerates a table the old database never had', async () => {
    const name = await seedOldDb(fixture())
    expect(await readOldData(name)).toEqual(parseOldBackup(fixture()))

    const partial = uniqueName('CCBillDB')
    const db = new Dexie(partial)
    db.version(1).stores({ owners: '&id', periods: '&id', transactions: '&id', expenses: '&id', installmentPlans: '&id', payments: '&id' })
    await db.open()
    await db.table('owners').put({ id: 'o1', name: 'Andi', color: 'blue' })
    db.close()
    expect(await readOldData(partial)).toMatchObject({ owners: [{ id: 'o1' }], paymentAllocations: [] })
  })

  it('G-01 rejects a damaged old database with the same clear errors', async () => {
    const data = fixture()
    data.transactions[0].amount = 1.5
    const name = await seedOldDb(data)
    await expect(readOldData(name)).rejects.toThrow('The amount of a transaction must be an integer number of rupiah, got number 1.5 (transactions[0].amount).')
  })

  it('G-04 the JSON backup has the old export format and round-trips through the parser', () => {
    const data = fixture()
    const json = oldBackupJson({ ...data, extra: 1 } as never, '2026-11-01T00:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(Object.keys(parsed)).toEqual(['owners', 'periods', 'transactions', 'expenses', 'installmentPlans', 'payments', 'paymentAllocations', 'exportedAt'])
    expect(parseOldBackup(json)).toEqual(parseOldBackup(data))
  })

  it('G-04 the fingerprint changes with any change to the data', () => {
    const a = fixture()
    const b = fixture()
    expect(fingerprint(a)).toBe(fingerprint(b))
    b.transactions[10].amount += 1
    expect(fingerprint(a)).not.toBe(fingerprint(b))
    expect(fingerprint(a)).toMatch(/^\d+:[0-9a-f]{8}$/)
  })
})
