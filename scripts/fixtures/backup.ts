// Synthetic backup in the CURRENT (pre-Phase-1) app's export format, used to test the migration.
// Shape mirrors exportData() in src/pages/Settings.tsx on main as of Slice 0.
import { household, isCredit, statements, type Line } from './data'

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

const MERCHANTS: [string, number, number, string][] = [
  // description, min, max, owner
  ['GRAB* A-%ID% JAKARTA PUSATID', 9000, 45000, 'Andi'],
  ['GOJEK *GOFOOD JAKARTA', 25000, 120000, 'Keluarga'],
  ['INDOMARET CILANDAK', 15000, 300000, 'Keluarga'],
  ['ALFAMART KEMANG', 12000, 180000, 'Keluarga'],
  ['KOPI KENANGAN SENOPATI', 18000, 60000, 'Andi'],
  ['SHOPEE.CO.ID *AP%ID% JAKARTA BARATID', 40000, 900000, 'Sari'],
  ['TOKOPEDIA JAKARTA', 30000, 700000, 'Sari'],
  ['GRAMEDIA MATRAMAN', 50000, 300000, 'Bima'],
  ['APOTEK K24 FATMAWATI', 20000, 250000, 'Medis'],
  ['PERTAMINA SPBU 34-12345', 100000, 400000, 'Keluarga'],
]

export function buildBackup() {
  const r = rng(20261031)
  const owners = ['Unknown', ...household.cards.bca.owners].map((name, i) => ({
    id: `own-${i}`, name, color: ['red', 'blue', 'pink', 'yellow', 'purple', 'teal'][i],
  }))
  const ownerId = (name: string) => owners.find((o) => o.name === name)!.id
  type Rec = Record<string, string | number | boolean | null | undefined>
  type Amounted = Rec & { id: string; amount: number }
  const periods: Rec[] = []
  const transactions: Amounted[] = []
  const expenses: Rec[] = []
  const paymentAllocations: Amounted[] = []
  let tx = 0, ex = 0, al = 0
  const pad = (n: number) => String(n).padStart(4, '0')

  const addTx = (periodId: string, line: { date: string; description: string; amount: number; type: string }) => {
    const id = `tx-${pad(++tx)}`
    transactions.push({ id, periodId, date: line.date, description: line.description, amount: line.amount, type: line.type, hidden: false, source: 'statement' })
    return id
  }
  const addExpense = (transactionId: string, owner: string, label: string, status: string) => {
    const id = `ex-${pad(++ex)}`
    expenses.push({ id, transactionId, label, ownerId: ownerId(owner), status })
    return id
  }

  // Jan–Jun 2026: generated filler months, each paid in full by one payment on the next statement.
  let carry: { exId: string; amount: number }[] = []
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, '0')
    const pid = `per-2026-${mm}`
    periods.push({ id: pid, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][m - 1]} 2026`, month: m, year: 2026, dueDate: `2026-${mm}-28`, importedAt: `2026-${mm}-13T00:00:00.000Z`, type: 'billed' })
    if (carry.length) {
      const total = carry.reduce((s, c) => s + c.amount, 0)
      const payTx = addTx(pid, { date: `2026-${String(m - 1 || 1).padStart(2, '0')}-27`, description: 'PEMBAYARAN - MBCA', amount: -total, type: 'payment' })
      for (const c of carry) paymentAllocations.push({ id: `al-${pad(++al)}`, paymentId: payTx, expenseId: c.exId, amount: c.amount })
    }
    carry = []
    for (let i = 0; i < 45; i++) {
      const [desc, min, max, owner] = MERCHANTS[Math.floor(r() * MERCHANTS.length)]
      const amount = Math.round((min + r() * (max - min)) / 100) * 100
      const day = String(1 + Math.floor(r() * 27)).padStart(2, '0')
      const id = addTx(pid, { date: `2026-${mm}-${day}`, description: desc.replace('%ID%', `${m}${i}X${Math.floor(r() * 9999)}`), amount, type: 'purchase' })
      const roll = r()
      if (roll < 0.1) continue // unlabeled: no expense row
      const who = roll < 0.18 ? 'Unknown' : owner
      const exId = addExpense(id, who, desc.split(/[*\s]/)[0], 'paid')
      carry.push({ exId, amount })
    }
  }

  // Jul–Sep 2026: the same BCA statements the PDF fixtures show, so both paths stay consistent.
  for (const st of statements.filter((s) => s.card === 'bca' && s.statementDate <= '2026-09-30')) {
    const m = +st.statementDate.slice(5, 7)
    const pid = `per-${st.statementDate.slice(0, 7)}`
    periods.push({ id: pid, label: `${['Jul', 'Aug', 'Sep'][m - 7]} 2026`, month: m, year: 2026, dueDate: st.dueDate, importedAt: `${st.statementDate}T09:00:00.000Z`, type: 'billed' })
    for (const l of st.lines as Line[]) {
      const id = addTx(pid, { date: l.txDate, description: l.description, amount: isCredit(l) ? -l.amount : l.amount, type: l.kind })
      if (l.kind === 'payment') {
        // Oldest first; a partly paid charge keeps its remainder for the next payment.
        let left = l.amount
        for (const c of carry) {
          const a = Math.min(left, c.amount)
          if (a > 0) { paymentAllocations.push({ id: `al-${pad(++al)}`, paymentId: id, expenseId: c.exId, amount: a }); c.amount -= a; left -= a }
        }
        carry = carry.filter((c) => c.amount > 0)
        continue
      }
      if (isCredit(l) || !l.expectedOwner) continue
      const exId = addExpense(id, l.needsCheck ? 'Unknown' : l.expectedOwner, l.installment ? l.installment.plan : l.description.split(/[*\s,]/)[0], 'unpaid')
      carry.push({ exId, amount: l.amount })
    }
  }
  periods.push({ id: 'unbilled-pool', label: 'Unbilled', month: 0, year: 0, importedAt: '2026-09-20T00:00:00.000Z', type: 'unbilled' })

  const installmentPlans = [
    { id: 'plan-1', name: 'Garmin Forerunner', originalAmount: 5999000, totalMonths: 12, monthlyAmount: 499917, startPeriod: '2026-07', ownerId: ownerId('Andi'), notes: '' },
  ]
  for (const e of expenses) {
    const t = transactions.find((x) => x.id === e.transactionId)!
    if (t.type === 'installment') e.installmentPlanId = 'plan-1'
    const paid = paymentAllocations.filter((a) => a.expenseId === e.id).reduce((s, a) => s + a.amount, 0)
    e.status = paid >= t.amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  }

  const data = { owners, periods, transactions, expenses, installmentPlans, payments: [], paymentAllocations, exportedAt: '2026-10-01T00:00:00.000Z' }
  const expected = {
    counts: Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
    totals: {
      charges: transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      credits: transactions.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
      allocated: paymentAllocations.reduce((s, a) => s + a.amount, 0),
    },
    unknownOwnerExpenses: expenses.filter((e) => e.ownerId === ownerId('Unknown')).length,
    unlabeledTransactions: transactions.filter((t) => t.amount > 0 && !expenses.some((e) => e.transactionId === t.id)).length,
  }
  return { data, expected }
}
