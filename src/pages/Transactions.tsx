import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId, getExpenseForTransaction } from '../db'
import {
  formatRupiah, formatDateShort, TX_TYPE_LABEL, TX_TYPE_COLOR,
  OWNER_COLOR_CLASSES,
} from '../lib/format'
import type { Transaction, Expense, Owner, InstallmentPlan } from '../types'

export default function Transactions() {
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []
  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []
  const installmentPlans = useLiveQuery(() => db.installmentPlans.toArray(), []) ?? []

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('all')
  const [filterOwner, setFilterOwner] = useState<string>('all')
  const [filterUnlabeled, setFilterUnlabeled] = useState(false)

  const transactions = useLiveQuery(async () => {
    let query = db.transactions.where('hidden').equals(0 as any)
    if (selectedPeriodId !== 'all') {
      return db.transactions
        .where('periodId').equals(selectedPeriodId)
        .filter((t) => !t.hidden)
        .sortBy('date')
    }
    return query.sortBy('date')
  }, [selectedPeriodId]) ?? []

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
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-shrink-0"
          >
            <option value="all">All Periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-shrink-0"
          >
            <option value="all">All Owners</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <button
            onClick={() => setFilterUnlabeled(!filterUnlabeled)}
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
  const [planId, setPlanId] = useState(initialExpense?.installmentPlanId ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const expense: Expense = {
      id: initialExpense?.id ?? generateId(),
      transactionId: tx.id,
      label: label.trim(),
      ownerId,
      installmentPlanId: planId || undefined,
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
          {/* Label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Label <span className="text-gray-400 font-normal">(what is this?)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Baby diapers, Gym membership…"
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

          {/* Installment plan link */}
          {tx.type === 'installment' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Installment Plan <span className="text-gray-400 font-normal">(what item is this cicilan for?)</span>
              </label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm"
              >
                <option value="">— Not linked —</option>
                {installmentPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <a href="#/installments" className="text-xs text-blue-600 mt-1 inline-block">
                + Create new installment plan
              </a>
            </div>
          )}

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
