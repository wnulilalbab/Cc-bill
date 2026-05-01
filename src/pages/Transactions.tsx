import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../db'
import {
  formatRupiah, formatRupiahCompact, formatDateShort, TX_TYPE_LABEL, TX_TYPE_COLOR,
  OWNER_COLOR_CLASSES, parseInstallmentDescription, periodLabelFromKey,
  type InstallmentInfo,
} from '../lib/format'
import type { Transaction, Expense, Owner, InstallmentPlan } from '../types'

const LS_PERIOD = 'tx_filter_period'
const LS_OWNER  = 'tx_filter_owner'
const LS_UNLABELED = 'tx_filter_unlabeled'

export default function Transactions() {
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []
  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []
  const installmentPlans = useLiveQuery(() => db.installmentPlans.toArray(), []) ?? []

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    () => localStorage.getItem(LS_PERIOD) ?? 'unbilled'
  )
  const [filterOwner, setFilterOwner] = useState<string>(
    () => localStorage.getItem(LS_OWNER) ?? 'all'
  )
  const [filterUnlabeled, setFilterUnlabeled] = useState<boolean>(
    () => localStorage.getItem(LS_UNLABELED) === '1'
  )

  function setPeriodFilter(id: string) {
    if (id === 'unbilled') localStorage.removeItem(LS_PERIOD)
    else localStorage.setItem(LS_PERIOD, id)
    setSelectedPeriodId(id)
  }

  function setOwnerFilter(id: string) {
    if (id === 'all') localStorage.removeItem(LS_OWNER)
    else localStorage.setItem(LS_OWNER, id)
    setFilterOwner(id)
  }

  function toggleUnlabeledFilter() {
    const next = !filterUnlabeled
    if (next) localStorage.setItem(LS_UNLABELED, '1')
    else localStorage.removeItem(LS_UNLABELED)
    setFilterUnlabeled(next)
  }

  const unbilledPeriodIds = useLiveQuery(async () => {
    const ps = await db.periods.filter((p) => p.type === 'unbilled').toArray()
    return ps.map((p) => p.id)
  }, []) ?? []

  const transactions = useLiveQuery(async () => {
    if (selectedPeriodId === 'unbilled') {
      if (unbilledPeriodIds.length === 0) return []
      return db.transactions
        .where('periodId').anyOf(unbilledPeriodIds)
        .filter((t) => !t.hidden)
        .sortBy('date')
    }
    if (selectedPeriodId !== 'all') {
      return db.transactions
        .where('periodId').equals(selectedPeriodId)
        .filter((t) => !t.hidden)
        .sortBy('date')
    }
    return db.transactions.where('hidden').equals(0 as any).sortBy('date')
  }, [selectedPeriodId, unbilledPeriodIds]) ?? []

  const expenses = useLiveQuery(() => db.expenses.toArray(), []) ?? []

  const expenseByTx = new Map(expenses.map((e) => [e.transactionId, e]))

  const [editingTx, setEditingTx] = useState<Transaction | null>(null)

  const filtered = transactions
    .filter((t) => {
      if (filterOwner !== 'all') {
        const exp = expenseByTx.get(t.id)
        if (!exp || exp.ownerId !== filterOwner) return false
      }
      if (filterUnlabeled) {
        const exp = expenseByTx.get(t.id)
        if (exp?.label) return false
      }
      return true
    })
    .reverse()

  const unlabeledCount = transactions.filter(
    (t) => !expenseByTx.get(t.id)?.label && t.type !== 'payment' && t.type !== 'reversal'
  ).length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-700 text-white px-4 py-4">
        <h1 className="text-lg font-bold">Transactions</h1>
        {unlabeledCount > 0 && (
          <p className="text-sm text-amber-300 mt-0.5">{unlabeledCount} need label</p>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select
            value={selectedPeriodId}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-shrink-0"
          >
            <option value="all">All Periods</option>
            <option value="unbilled">⏳ Unbilled (Pending)</option>
            {periods.filter((p) => p.type !== 'unbilled').map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>


          <select
            value={filterOwner}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-shrink-0"
          >
            <option value="all">All Owners</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <button
            onClick={toggleUnlabeledFilter}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm border ${filterUnlabeled ? 'bg-amber-100 text-amber-700 border-amber-300' : 'border-gray-300 text-gray-600'}`}
          >
            Needs Label
          </button>
        </div>
      </div>

      {/* List */}
      <div className="divide-y divide-gray-100">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p>No transactions yet</p>
            <p className="text-sm mt-1">Import a bill to get started</p>
          </div>
        )}
        {filtered.map((tx) => {
          const exp = expenseByTx.get(tx.id)
          const owner = owners.find((o) => o.id === exp?.ownerId)
          const needsLabel = !exp?.label && tx.type !== 'payment' && tx.type !== 'reversal'

          return (
            <button
              key={tx.id}
              onClick={() => setEditingTx(tx)}
              className="w-full text-left bg-white px-4 py-3 flex items-start gap-3 active:bg-gray-50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <span className="text-xs text-gray-400">{formatDateShort(tx.date)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLOR[tx.type]}`}>
                    {TX_TYPE_LABEL[tx.type]}
                  </span>
                  {tx.source === 'screenshot' && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                      Pending
                    </span>
                  )}
                  {owner && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${OWNER_COLOR_CLASSES[owner.color]?.bg} ${OWNER_COLOR_CLASSES[owner.color]?.text}`}>
                      {owner.name}
                    </span>
                  )}
                  {needsLabel && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                      needs label
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-800 truncate">
                  {exp?.label || tx.description}
                </p>
                {exp?.label && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{tx.description}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-semibold ${tx.amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                  {tx.amount < 0 ? '-' : ''}{formatRupiah(tx.amount)}
                </p>
                {exp?.status && (
                  <span className={`text-xs ${exp.status === 'paid' ? 'text-green-600' : exp.status === 'partial' ? 'text-amber-600' : 'text-gray-400'}`}>
                    {exp.status}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {editingTx && (
        <EnrichSheet
          tx={editingTx}
          owners={owners}
          installmentPlans={installmentPlans}
          initialExpense={expenseByTx.get(editingTx.id)}
          onClose={() => setEditingTx(null)}
        />
      )}
    </div>
  )
}

function EnrichSheet({
  tx,
  owners,
  installmentPlans,
  initialExpense,
  onClose,
}: {
  tx: Transaction
  owners: Owner[]
  installmentPlans: InstallmentPlan[]
  initialExpense?: Expense
  onClose: () => void
}) {
  const [label, setLabel] = useState(initialExpense?.label ?? '')
  const [ownerId, setOwnerId] = useState(initialExpense?.ownerId ?? owners[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  // Load the bill period so we can compute installment dates
  const period = useLiveQuery(() => db.periods.get(tx.periodId), [tx.periodId])

  // Auto-parse installment info from description
  const info: InstallmentInfo | null =
    tx.type === 'installment' && period
      ? parseInstallmentDescription(tx.description, tx.amount, period.year, period.month)
      : null

  // Find an existing plan that matches (same total months, same start, ~same monthly amount)
  const matchingPlan = useLiveQuery(async () => {
    if (!info) return null
    const plans = await db.installmentPlans.toArray()
    return (
      plans.find(
        (p) =>
          p.totalMonths === info.totalMonths &&
          p.startPeriod === info.startPeriod &&
          Math.abs(p.monthlyAmount - info.monthlyAmount) <= info.monthlyAmount * 0.05
      ) ?? null
    )
  }, [info?.startPeriod, info?.totalMonths, info?.monthlyAmount])

  // Pre-fill label from matched plan if user hasn't typed anything
  useEffect(() => {
    if (matchingPlan && !label && !initialExpense?.label) {
      setLabel(matchingPlan.name)
    }
  }, [matchingPlan])

  async function save() {
    setSaving(true)

    let resolvedPlanId = initialExpense?.installmentPlanId ?? ''

    if (info && tx.type === 'installment') {
      if (matchingPlan) {
        // Link to existing plan; update its name if user changed the label
        resolvedPlanId = matchingPlan.id
        if (label.trim() && label.trim() !== matchingPlan.name) {
          await db.installmentPlans.update(matchingPlan.id, { name: label.trim() })
        }
      } else if (label.trim()) {
        // Create a new plan from parsed info
        const newPlan: InstallmentPlan = {
          id: generateId(),
          name: label.trim(),
          originalAmount: info.originalAmount,
          totalMonths: info.totalMonths,
          monthlyAmount: info.monthlyAmount,
          startPeriod: info.startPeriod,
          ownerId,
          notes: '',
        }
        await db.installmentPlans.put(newPlan)
        resolvedPlanId = newPlan.id
      }
    }

    const expense: Expense = {
      id: initialExpense?.id ?? generateId(),
      transactionId: tx.id,
      label: label.trim(),
      ownerId,
      installmentPlanId: resolvedPlanId || undefined,
      status: initialExpense?.status ?? 'unpaid',
    }
    await db.expenses.put(expense)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="px-4 pb-2">
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${TX_TYPE_COLOR[tx.type]}`}>
            {TX_TYPE_LABEL[tx.type]}
          </div>
          <p className="text-sm text-gray-500 mt-2 break-all">{tx.description}</p>
          <p className={`text-xl font-bold mt-1 ${tx.amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
            {tx.amount < 0 ? '-' : ''}{formatRupiah(tx.amount)}
          </p>
          <p className="text-xs text-gray-400">{formatDateShort(tx.date)}</p>
        </div>

        <div className="px-4 pt-2 pb-6 space-y-4">

          {/* Auto-detected installment info */}
          {info && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                  Installment Auto-Detected
                </span>
                {matchingPlan ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    linked to existing plan
                  </span>
                ) : (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    new plan will be created
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-gray-400">Progress</span>
                  <p className="font-semibold text-gray-800">
                    Month {info.currentMonth} of {info.totalMonths}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400">Monthly</span>
                  <p className="font-semibold text-gray-800">{formatRupiahCompact(info.monthlyAmount)}</p>
                </div>
                <div>
                  <span className="text-gray-400">Start</span>
                  <p className="font-semibold text-gray-800">{periodLabelFromKey(info.startPeriod)}</p>
                </div>
                <div>
                  <span className="text-gray-400">End</span>
                  <p className="font-semibold text-gray-800">{periodLabelFromKey(info.endPeriod)}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-400">Original total</span>
                  <p className="font-semibold text-gray-800">{formatRupiah(info.originalAmount)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {tx.type === 'installment'
                ? <>What is this installment for? <span className="text-red-400">*</span></>
                : <>Label <span className="text-gray-400 font-normal">(what is this?)</span></>
              }
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={tx.type === 'installment' ? 'e.g. Laptop Lenovo, iPhone 15…' : 'e.g. Baby diapers, Gym membership…'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Owner */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Owner / PIC</label>
            <div className="flex flex-wrap gap-2">
              {owners.map((o) => {
                const c = OWNER_COLOR_CLASSES[o.color] ?? OWNER_COLOR_CLASSES.blue
                const selected = ownerId === o.id
                return (
                  <button
                    key={o.id}
                    onClick={() => setOwnerId(o.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${c.bg} ${c.text} ${selected ? 'ring-2 ring-offset-1 ring-blue-500 scale-105' : 'opacity-60'}`}
                  >
                    {o.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-300 rounded-lg py-3 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
