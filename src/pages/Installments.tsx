import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../db'
import { formatRupiah, formatRupiahCompact, OWNER_COLOR_CLASSES, periodKey } from '../lib/format'
import type { InstallmentPlan, Owner } from '../types'

export default function Installments() {
  const plans = useLiveQuery(() => db.installmentPlans.toArray(), []) ?? []
  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []
  const planExpenses = useLiveQuery(
    () => db.expenses.filter((e) => !!e.installmentPlanId).toArray(),
    []
  ) ?? []
  const allAllocations = useLiveQuery(() => db.paymentAllocations.toArray(), []) ?? []
  const [editing, setEditing] = useState<Partial<InstallmentPlan> | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  const importedByPlan = new Map<string, number>()
  for (const exp of planExpenses) {
    if (exp.installmentPlanId) {
      importedByPlan.set(exp.installmentPlanId, (importedByPlan.get(exp.installmentPlanId) ?? 0) + 1)
    }
  }

  function openNew() {
    const now = new Date()
    setEditing({
      name: '',
      originalAmount: 0,
      totalMonths: 12,
      monthlyAmount: 0,
      startPeriod: periodKey(now.getFullYear(), now.getMonth() + 1),
      ownerId: owners[0]?.id ?? '',
      notes: '',
    })
    setShowForm(true)
  }

  function openEdit(plan: InstallmentPlan) {
    setEditing({ ...plan })
    setShowForm(true)
  }

  async function savePlan() {
    if (!editing?.name?.trim() || !editing.ownerId) return
    const plan: InstallmentPlan = {
      id: editing.id ?? generateId(),
      name: editing.name.trim(),
      originalAmount: editing.originalAmount ?? 0,
      totalMonths: editing.totalMonths ?? 12,
      monthlyAmount: editing.monthlyAmount ?? Math.round((editing.originalAmount ?? 0) / (editing.totalMonths ?? 12)),
      startPeriod: editing.startPeriod ?? periodKey(new Date().getFullYear(), new Date().getMonth() + 1),
      ownerId: editing.ownerId,
      notes: editing.notes ?? '',
    }
    await db.installmentPlans.put(plan)
    setShowForm(false)
    setEditing(null)
  }

  async function deletePlan(id: string) {
    if (!confirm('Delete this installment plan?')) return
    await db.installmentPlans.delete(id)
  }

  function calcProgress(plan: InstallmentPlan) {
    const [y, m] = plan.startPeriod.split('-').map(Number)
    const start = new Date(y, m - 1, 1)
    const now = new Date()
    const passed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    return Math.min(passed + 1, plan.totalMonths)
  }

  const planExpenseIds = new Set(planExpenses.map((e) => e.id))
  const totalImported = plans.reduce((s, plan) => {
    const imported = importedByPlan.get(plan.id) ?? 0
    return s + plan.monthlyAmount * imported
  }, 0)
  const totalPaid = allAllocations
    .filter((a) => planExpenseIds.has(a.expenseId))
    .reduce((s, a) => s + a.amount, 0)
  const totalPending = Math.max(0, totalImported - totalPaid)

  const completedCount = plans.filter((p) => calcProgress(p) >= p.totalMonths).length
  const visiblePlans = showCompleted
    ? plans
    : plans.filter((p) => calcProgress(p) < p.totalMonths)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-700 text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Installment Plans</h1>
            <p className="text-sm text-blue-200 mt-0.5">
              {visiblePlans.length} active{completedCount > 0 ? ` · ${completedCount} completed` : ''}
            </p>
          </div>
          <button
            onClick={openNew}
            className="bg-white text-blue-700 rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            + New
          </button>
        </div>
      </div>

      {/* Summary card */}
      {plans.length > 0 && (
        <div className="px-4 pt-4">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Overall Summary</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-gray-400">In System</p>
                <p className="text-sm font-semibold text-gray-900">{formatRupiah(totalImported)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Paid</p>
                <p className="text-sm font-semibold text-green-600">{formatRupiah(totalPaid)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Pending</p>
                <p className="text-sm font-semibold text-orange-600">{formatRupiah(totalPending)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-4 space-y-3">
        {plans.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📦</p>
            <p>No installment plans yet</p>
            <p className="text-sm mt-1">Create one to link your cicilan transactions</p>
            <button onClick={openNew} className="mt-4 bg-blue-600 text-white rounded-xl px-5 py-2.5 text-sm font-medium">
              + Create Plan
            </button>
          </div>
        )}

        {completedCount > 0 && (
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="w-full text-sm text-gray-400 py-1 text-center"
          >
            {showCompleted ? `Hide ${completedCount} completed plan${completedCount > 1 ? 's' : ''}` : `Show ${completedCount} completed plan${completedCount > 1 ? 's' : ''}`}
          </button>
        )}

        {visiblePlans.map((plan) => {
          const owner = owners.find((o) => o.id === plan.ownerId)
          const c = owner ? (OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue) : OWNER_COLOR_CLASSES.blue
          const current = calcProgress(plan)
          const pct = (current / plan.totalMonths) * 100
          const monthsLeft = plan.totalMonths - current
          const totalRemaining = monthsLeft * plan.monthlyAmount
          const importedCount = importedByPlan.get(plan.id) ?? 0
          const unbilledLeft = Math.max(0, plan.totalMonths - importedCount)

          return (
            <div key={plan.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{plan.name}</p>
                  {plan.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{plan.notes}</p>}
                </div>
                {owner && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${c.bg} ${c.text}`}>
                    {owner.name}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div className="mb-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{current} of {plan.totalMonths} months</span>
                  <span>{monthsLeft > 0 ? `${monthsLeft} remaining` : 'Complete'}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${monthsLeft === 0 ? 'bg-green-500' : c.dot}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-gray-400">
                    {importedCount}/{plan.totalMonths} months in system
                  </span>
                  {unbilledLeft > 0 ? (
                    <span className="text-amber-600 font-medium">
                      {unbilledLeft} unbilled
                    </span>
                  ) : (
                    <span className="text-green-600">all billed ✓</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mt-3">
                <div>
                  <p className="text-xs text-gray-400">Monthly</p>
                  <p className="text-sm font-semibold text-gray-900">{formatRupiahCompact(plan.monthlyAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Original</p>
                  <p className="text-sm font-semibold text-gray-900">{formatRupiahCompact(plan.originalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Left</p>
                  <p className={`text-sm font-semibold ${monthsLeft === 0 ? 'text-green-600' : 'text-gray-900'}`}>
                    {monthsLeft === 0 ? 'Done' : formatRupiahCompact(totalRemaining)}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => openEdit(plan)} className="flex-1 text-sm text-blue-600 py-1">Edit</button>
                <button onClick={() => deletePlan(plan.id)} className="flex-1 text-sm text-red-500 py-1">Delete</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Form Sheet */}
      {showForm && editing && (
        <div className="fixed inset-0 z-50" onClick={() => setShowForm(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[90vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                {editing.id ? 'Edit Plan' : 'New Installment Plan'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">Item Name *</label>
                <input
                  type="text"
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Laptop Lenovo, iPhone 15"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm text-gray-600">Original Amount</label>
                  <input
                    type="number"
                    value={editing.originalAmount ?? 0}
                    onChange={(e) => {
                      const orig = Number(e.target.value)
                      const monthly = editing.totalMonths ? Math.round(orig / editing.totalMonths) : 0
                      setEditing((p) => ({ ...p, originalAmount: orig, monthlyAmount: monthly }))
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Total Months</label>
                  <input
                    type="number"
                    value={editing.totalMonths ?? 12}
                    onChange={(e) => {
                      const months = Number(e.target.value)
                      const monthly = editing.originalAmount ? Math.round(editing.originalAmount / months) : 0
                      setEditing((p) => ({ ...p, totalMonths: months, monthlyAmount: monthly }))
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">Monthly Amount (auto-calculated)</label>
                <input
                  type="number"
                  value={editing.monthlyAmount ?? 0}
                  onChange={(e) => setEditing((p) => ({ ...p, monthlyAmount: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Start Period (YYYY-MM)</label>
                <input
                  type="month"
                  value={editing.startPeriod ?? ''}
                  onChange={(e) => setEditing((p) => ({ ...p, startPeriod: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Owner / PIC *</label>
                <select
                  value={editing.ownerId ?? ''}
                  onChange={(e) => setEditing((p) => ({ ...p, ownerId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                >
                  <option value="">Select owner…</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-600">Notes (optional)</label>
                <input
                  type="text"
                  value={editing.notes ?? ''}
                  onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g. from Blibli, ordered Jan 2026"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-300 rounded-lg py-3 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={savePlan}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium"
                >
                  Save Plan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
