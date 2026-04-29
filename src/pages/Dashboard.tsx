import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatRupiah, formatRupiahCompact, OWNER_COLOR_CLASSES } from '../lib/format'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const navigate = useNavigate()
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')

  const activePeriodId = selectedPeriodId || periods[0]?.id || ''
  const activePeriod = periods.find((p) => p.id === activePeriodId)

  const transactions = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.transactions.where('periodId').equals(activePeriodId).filter((t) => !t.hidden).toArray()
  }, [activePeriodId]) ?? []

  const expenses = useLiveQuery(async () => {
    if (!activePeriodId) return []
    const txIds = (await db.transactions.where('periodId').equals(activePeriodId).toArray()).map((t) => t.id)
    return db.expenses.where('transactionId').anyOf(txIds).toArray()
  }, [activePeriodId]) ?? []

  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []

  const installmentPlans = useLiveQuery(() => db.installmentPlans.toArray(), []) ?? []

  const allAllocations = useLiveQuery(() => db.paymentAllocations.toArray(), []) ?? []

  const expenseByTx = new Map(expenses.map((e) => [e.transactionId, e]))

  // Totals
  const charges = transactions.filter((t) => t.amount > 0 && t.type !== 'fee' && t.type !== 'interest')
  const totalBill = charges.reduce((s, t) => s + t.amount, 0)

  const payments = transactions.filter((t) => t.type === 'payment')
  const totalPaid = payments.reduce((s, t) => s + Math.abs(t.amount), 0)
  const remaining = Math.max(0, totalBill - totalPaid)

  // By owner
  const ownerTotals = owners.map((owner) => {
    const ownerTxs = transactions.filter((t) => {
      const exp = expenseByTx.get(t.id)
      return exp?.ownerId === owner.id && t.amount > 0
    })
    return {
      owner,
      total: ownerTxs.reduce((s, t) => s + t.amount, 0),
      count: ownerTxs.length,
    }
  }).filter((o) => o.total > 0)

  const unassigned = transactions.filter((t) => {
    const exp = expenseByTx.get(t.id)
    return !exp?.ownerId && t.amount > 0
  }).reduce((s, t) => s + t.amount, 0)

  const unlabeled = transactions.filter(
    (t) => !expenseByTx.get(t.id)?.label && t.type !== 'payment' && t.type !== 'reversal'
  ).length

  if (periods.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-6xl">💳</div>
        <h2 className="text-xl font-bold text-gray-900">Welcome to CC Bill</h2>
        <p className="text-gray-500 text-sm">Start by importing your first credit card statement</p>
        <button
          onClick={() => navigate('/import')}
          className="bg-blue-600 text-white rounded-xl px-6 py-3 font-medium"
        >
          Import First Bill
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="text-blue-600 text-sm underline"
        >
          Set up API key first →
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-700 text-white px-4 pt-4 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-bold">CC Bill</h1>
          <select
            value={activePeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="bg-blue-800 text-white text-sm rounded-lg px-2 py-1.5 border border-blue-600"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        {activePeriod?.dueDate && (
          <p className="text-sm text-blue-200">
            Due: {new Date(activePeriod.dueDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>

      <div className="px-4 -mt-3 space-y-3 pb-6">
        {/* Bill summary card */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Total Bill</p>
          <p className="text-3xl font-bold text-gray-900">{formatRupiah(totalBill)}</p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-xl p-3">
              <p className="text-xs text-green-600 mb-0.5">Paid</p>
              <p className="text-base font-bold text-green-700">{formatRupiahCompact(totalPaid)}</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-3">
              <p className="text-xs text-orange-600 mb-0.5">Remaining</p>
              <p className="text-base font-bold text-orange-700">{formatRupiahCompact(remaining)}</p>
            </div>
          </div>
        </div>

        {/* Unlabeled alert */}
        {unlabeled > 0 && (
          <button
            onClick={() => navigate('/transactions')}
            className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 text-left flex items-center gap-3"
          >
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-800">{unlabeled} transactions need a label</p>
              <p className="text-xs text-amber-600">Tap to assign owners and labels →</p>
            </div>
          </button>
        )}

        {/* By owner */}
        {ownerTotals.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">By Owner</p>
            <div className="space-y-3">
              {ownerTotals.map(({ owner, total, count }) => {
                const c = OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue
                const pct = totalBill > 0 ? (total / totalBill) * 100 : 0
                return (
                  <div key={owner.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                        {owner.name}
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{formatRupiah(total)}</span>
                        <span className="text-xs text-gray-400 ml-1">({count} items)</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${c.dot} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
              {unassigned > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Unassigned</span>
                  <span className="text-amber-600 font-medium">{formatRupiah(unassigned)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active installments */}
        {installmentPlans.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900">Active Installments</p>
              <button onClick={() => navigate('/installments')} className="text-xs text-blue-600">See all</button>
            </div>
            <div className="space-y-2">
              {installmentPlans.slice(0, 5).map((plan) => {
                const owner = owners.find((o) => o.id === plan.ownerId)
                const c = owner ? (OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue) : OWNER_COLOR_CLASSES.blue
                const now = new Date()
                const start = new Date(plan.startPeriod + '-01')
                const monthsPassed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
                const current = Math.min(monthsPassed + 1, plan.totalMonths)
                const remaining = plan.totalMonths - current

                return (
                  <div key={plan.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{plan.name}</p>
                      <p className="text-xs text-gray-400">
                        {current}/{plan.totalMonths} mo · {formatRupiahCompact(plan.monthlyAmount)}/mo
                        {remaining > 0 ? ` · ${remaining} left` : ' · done'}
                      </p>
                    </div>
                    {owner && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ml-2 ${c.bg} ${c.text}`}>
                        {owner.name}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/import')}
            className="bg-blue-600 text-white rounded-xl py-3 text-sm font-medium"
          >
            + Import Bill
          </button>
          <button
            onClick={() => navigate('/payments')}
            className="bg-white border border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-medium shadow-sm"
          >
            Manage Payments
          </button>
        </div>
      </div>
    </div>
  )
}
