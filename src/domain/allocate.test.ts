import { describe, expect, it } from 'vitest'
import { billed, ledger, pay, tx, unbilled } from '../../test/domain/builders'
import {
  candidates,
  checkDraft,
  draftFromPayment,
  fillOldestFirst,
  payAllInStatement,
  payFull,
  savePayment,
  selectOwner,
  setAllocation,
  tapCharge,
  type AssignDraft,
} from './allocate'
import { MoneyError } from './money'

// Statements deliberately out of order: the page must sort them.
const statements = [unbilled(), billed('oct', '2026-10-12', '2026-10-28'), billed('aug', '2026-08-12', '2026-08-28'), billed('sep', '2026-09-12', '2026-09-28')]
const transactions = [
  tx('u1', 'unb', '2026-10-16', 320000, 'sari'),
  tx('o2', 'oct', '2026-10-05', 300000, 'sari'),
  tx('o1', 'oct', '2026-09-28', 150000, 'sari'),
  tx('s1', 'sep', '2026-09-03', 200000, 'sari'),
  tx('s2', 'sep', '2026-09-05', 80000, 'sari'),
  tx('a1', 'aug', '2026-07-21', 1252000, 'sari'),
  tx('later', 'unb', '2026-10-25', 50000, 'sari'),
  tx('refund', 'oct', '2026-10-06', -10000, 'sari'),
  tx('andi1', 'oct', '2026-10-01', 90000, 'andi'),
  tx('nobody', 'oct', '2026-10-01', 5000, null),
  tx('other-card', 'oct', '2026-10-01', 5000, 'sari', { cardId: 'm' }),
]
const q = pay('q', '2026-09-10', 80000, { allocations: [{ txId: 's2', amount: 80000 }] })
const l = ledger({ statements, transactions, payments: [q] })
const draft = (extra: Partial<AssignDraft> = {}): AssignDraft => ({ cardId: 'c', date: '2026-10-20', amount: 500000, ownerIds: ['sari'], multi: false, allocations: {}, ...extra })

describe('candidate charges', () => {
  it('P-01 groups are ordered oldest statement first, Unbilled last, charges by date', () => {
    const c = candidates(l, draft())
    expect(c.groups.map((g) => [g.statementId, g.items.map((i) => i.txId), g.openTotal])).toEqual([
      ['aug', ['a1'], 1252000],
      ['sep', ['s1'], 200000],
      ['oct', ['o1', 'o2'], 450000],
      ['unb', ['u1'], 320000],
    ])
    expect(c.groups[2].items[0]).toEqual({ txId: 'o1', ownerId: 'sari', date: '2026-09-28', open: 150000, assigned: 0 })
  })

  it('P-02 charges dated after the payment date are hidden and counted', () => {
    expect(candidates(l, draft()).hiddenLater).toBe(1)
    expect(candidates(l, draft({ date: '2026-10-25' })).hiddenLater).toBe(0)
    // Already ticked, it stays visible.
    const ticked = candidates(l, draft({ allocations: { later: 50000 } }))
    expect(ticked.hiddenLater).toBe(0)
    expect(ticked.groups[3].items.map((i) => [i.txId, i.assigned])).toEqual([['u1', 0], ['later', 50000]])
  })

  it('P-03 charges fully paid by other payments are hidden and counted; this payment\'s own assignments are not "other"', () => {
    expect(candidates(l, draft()).hiddenPaid).toBe(1)
    const editing = ledger({ statements, transactions, payments: [q] })
    const c = candidates(editing, draft({ paymentId: 'q', allocations: { s2: 80000 } }))
    expect(c.hiddenPaid).toBe(0)
    expect(c.groups[1].items.map((i) => [i.txId, i.open])).toEqual([['s1', 200000], ['s2', 80000]])
  })

  it('M-D-50 a deposit already paying a charge reduces what is open on it', () => {
    const withDeposit = ledger({ statements, transactions, payments: [q, pay('dep', '2026-10-15', 100000, { depositOwnerId: 'sari' })] })
    expect(candidates(withDeposit, draft({ date: '2026-10-30' })).groups[3].items.map((i) => [i.txId, i.open])).toEqual([['u1', 220000], ['later', 50000]])
    // Editing the deposit payment itself: its deposit is left out.
    expect(candidates(withDeposit, draft({ paymentId: 'dep', date: '2026-10-30' })).groups[3].items[0].open).toBe(320000)
  })
})

describe('tapping charges', () => {
  it('P-04 tapping a 1.252.000 charge with 500.000 left assigns 500.000 (partial)', () => {
    const r = tapCharge(l, draft(), 'a1')
    expect(r.outcome).toBe('partial')
    expect(r.amount).toBe(500000)
    expect(r.draft.allocations).toEqual({ a1: 500000 })
  })

  it('M-D-51 tapping a charge that fits assigns its open amount; tapping again unticks it', () => {
    const r = tapCharge(l, draft(), 's1')
    expect(r).toMatchObject({ outcome: 'assigned', amount: 200000 })
    expect(r.draft.allocations).toEqual({ s1: 200000 })
    const exact = tapCharge(l, draft({ amount: 200000 }), 's1')
    expect(exact).toMatchObject({ outcome: 'assigned', amount: 200000 })
    const off = tapCharge(l, r.draft, 's1')
    expect(off).toMatchObject({ outcome: 'unticked', amount: 0 })
    expect(off.draft.allocations).toEqual({})
  })

  it('P-05 tapping when the payment is fully assigned assigns nothing ("Untick something first")', () => {
    const full = draft({ allocations: { a1: 500000 } })
    const r = tapCharge(l, full, 's1')
    expect(r).toEqual({ draft: full, outcome: 'paymentFull', amount: 0 })
    expect(tapCharge(l, draft({ allocations: { a1: 600000 } }), 's1').outcome).toBe('paymentFull')
  })

  it('M-D-52 tapping a charge with nothing open changes nothing; unknown charges throw', () => {
    const d = draft()
    expect(tapCharge(l, d, 's2')).toEqual({ draft: d, outcome: 'nothingOpen', amount: 0 })
    expect(() => tapCharge(l, d, 'nope')).toThrow('unknown transaction nope')
  })
})

describe('fill helpers', () => {
  const five = ledger({
    statements,
    transactions: [
      tx('e', 'oct', '2026-10-05', 150000, 'bima'),
      tx('b', 'sep', '2026-09-02', 150000, 'bima'),
      tx('a', 'sep', '2026-09-01', 150000, 'bima'),
      tx('d', 'oct', '2026-10-01', 150000, 'bima'),
      tx('c', 'sep', '2026-09-03', 150000, 'bima'),
      tx('x', 'aug', '2026-08-01', 70000, 'andi'),
    ],
  })
  const bima = (extra: Partial<AssignDraft> = {}) => draft({ ownerIds: ['bima'], ...extra })

  it('P-06 Fill oldest first: 500.000 over five charges fills in date order and stops at 500.000', () => {
    const r = fillOldestFirst(five, bima({ allocations: { e: 1000 } }))
    expect(r.draft.allocations).toEqual({ a: 150000, b: 150000, c: 150000, d: 50000 })
    expect(r.filled).toBe(4)
    expect(r.of).toBe(5)
    expect(checkDraft(five, r.draft)).toMatchObject({ left: 0, overPayment: false, canSave: true })
  })

  it('P-07 Pay all in this statement: same cap, "ran out after n of m"', () => {
    const r = payAllInStatement(five, bima({ amount: 400000, allocations: { e: 100000, b: 1 } }), 'sep')
    expect(r.draft.allocations).toEqual({ e: 100000, a: 150000, b: 150000 })
    expect(r).toMatchObject({ filled: 2, of: 3, ranOut: true })
    const enough = payAllInStatement(five, bima({ amount: 450000 }), 'sep')
    expect(enough).toMatchObject({ filled: 3, of: 3, ranOut: false })
    const lastPartial = payAllInStatement(five, bima({ amount: 449999 }), 'sep')
    expect(lastPartial).toMatchObject({ filled: 3, of: 3, ranOut: true })
    expect(lastPartial.draft.allocations).toEqual({ a: 150000, b: 150000, c: 149999 })
    const none = bima()
    expect(payAllInStatement(five, none, 'unb')).toEqual({ draft: none, filled: 0, of: 0, ranOut: false })
  })

  it('P-08 Pay full after a partial = min(open, current + left)', () => {
    const big = draft({ amount: 1500000, allocations: { s1: 200000, a1: 300000 } })
    const r = payFull(l, big, 'a1')
    expect(r.draft.allocations.a1).toBe(1252000)
    expect(r.full).toBe(true)
    const short = payFull(l, draft({ allocations: { a1: 500000 } }), 'a1')
    expect(short.draft.allocations.a1).toBe(500000)
    expect(short.full).toBe(false)
    const over = payFull(l, draft({ allocations: { a1: 600000 } }), 'a1')
    expect(over.draft.allocations.a1).toBe(600000)
    const fromZero = payFull(l, draft({ amount: 100000 }), 's1')
    expect(fromZero.draft.allocations.s1).toBe(100000)
  })
})

describe('checking and saving', () => {
  it('P-09 over-assigning by typing disables Save', () => {
    const d = setAllocation(draft({ allocations: { a1: 500000 } }), 'a1', 600000)
    expect(checkDraft(l, d)).toEqual({ assigned: 600000, left: -100000, overPayment: true, overCharges: [], canSave: false })
    expect(() => savePayment(l, pay('p', '2026-10-20', 500000), d, null)).toThrow(MoneyError)
    const charge = setAllocation(draft(), 's1', 250000)
    expect(checkDraft(l, charge)).toEqual({ assigned: 250000, left: 250000, overPayment: false, overCharges: ['s1'], canSave: false })
    expect(checkDraft(l, setAllocation(draft(), 's1', 200000)).canSave).toBe(true)
    expect(checkDraft(l, draft({ amount: 0 })).canSave).toBe(false)
    expect(() => checkDraft(l, draft({ amount: 1.5 }))).toThrow(MoneyError)
    expect(() => setAllocation(draft(), 's1', -1)).toThrow('assigned amount cannot be negative')
    expect(() => setAllocation(draft(), 's1', 0.5)).toThrow('assigned amount must be an integer')
  })

  it('P-10 single-person mode: tapping another owner switches person and clears the ticks', () => {
    const d = draft({ allocations: { s1: 200000 } })
    expect(selectOwner(l, d, 'sari')).toBe(d)
    expect(selectOwner(l, d, 'andi')).toEqual({ ...d, ownerIds: ['andi'], allocations: {} })
    expect(selectOwner(l, draft({ ownerIds: [] }), 'sari').ownerIds).toEqual(['sari'])
    expect(selectOwner(l, draft({ ownerIds: ['sari', 'andi'] }), 'sari').ownerIds).toEqual(['sari'])
  })

  it('P-11 multi-person mode: several owners selectable, rows carry the owner, deselecting drops that owner\'s ticks', () => {
    const d = selectOwner(l, draft({ multi: true, allocations: { s1: 200000 } }), 'andi')
    expect(d.ownerIds).toEqual(['sari', 'andi'])
    expect(d.allocations).toEqual({ s1: 200000 })
    const oct = candidates(l, d).groups.find((g) => g.statementId === 'oct')!
    expect(oct.items.map((i) => [i.txId, i.ownerId])).toEqual([['o1', 'sari'], ['andi1', 'andi'], ['o2', 'sari']])
    const ticked = { ...d, allocations: { ...d.allocations, andi1: 90000 } }
    expect(selectOwner(l, ticked, 'sari')).toEqual({ ...ticked, ownerIds: ['andi'], allocations: { andi1: 90000 } })
  })

  it('P-18 an existing split payment opens with its assignments, which can be changed and saved', () => {
    const split = pay('split', '2026-10-20', 500000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 's1', amount: 200000 }, { txId: 'andi1', amount: 90000 }, { txId: 's1', amount: 10000 }] })
    const ll = ledger({ statements, transactions, payments: [q, split] })
    const d = draftFromPayment(split, transactions)
    expect(d).toEqual({ paymentId: 'split', cardId: 'c', date: '2026-10-20', amount: 500000, ownerIds: ['sari', 'andi'], multi: true, allocations: { s1: 210000, andi1: 90000 } })
    expect(checkDraft(ll, d).overCharges).toEqual(['s1'])
    const fixed = setAllocation(setAllocation(d, 's1', 200000), 'o1', 150000)
    const saved = savePayment(ll, split, fixed, null)
    expect(saved.allocations).toEqual([{ txId: 's1', amount: 200000 }, { txId: 'andi1', amount: 90000 }, { txId: 'o1', amount: 150000 }])
    expect(saved.depositOwnerId).toBeUndefined()
    expect(draftFromPayment(pay('x', '2026-10-01', 5, { forOwnerIds: ['bima'], allocations: [{ txId: 'zzz', amount: 1 }, { txId: 'nobody', amount: 1 }] }), transactions)).toMatchObject({ ownerIds: ['bima'], multi: false })
  })

  it('M-D-53 leftover becomes the chosen owner\'s deposit; "Decide later" leaves it unassigned', () => {
    const base = pay('p', '2026-10-20', 500000, { depositOwnerId: 'old' })
    const d = draft({ allocations: { s1: 200000, o1: 0 } })
    const kept = savePayment(l, base, d, 'sari')
    expect(kept).toEqual({ id: 'p', cardId: 'c', source: 'manual', date: '2026-10-20', amount: 500000, allocations: [{ txId: 's1', amount: 200000 }], forOwnerIds: ['sari'], depositOwnerId: 'sari' })
    expect('depositOwnerId' in savePayment(l, base, d, null)).toBe(false)
    expect('depositOwnerId' in savePayment(l, base, draft({ allocations: { a1: 500000 } }), 'sari')).toBe(false)
  })

  it('P-12 saving a bank payment keeps its amount and date; a hand payment takes the typed ones', () => {
    const bank = pay('b', '2026-10-20', 500000, { source: 'statement', statementId: 'oct' })
    const typed = draft({ amount: 900000, date: '2026-10-01', allocations: { s1: 200000 } })
    expect(savePayment(l, bank, typed, null)).toMatchObject({ amount: 500000, date: '2026-10-20' })
    expect(() => savePayment(l, bank, draft({ amount: 900000, allocations: { a1: 600000 } }), null)).toThrow(MoneyError)
    expect(savePayment(l, pay('h', '2026-10-20', 500000), typed, null)).toMatchObject({ amount: 900000, date: '2026-10-01' })
  })
})
