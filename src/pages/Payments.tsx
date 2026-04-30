import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId, UNBILLED_PERIOD_ID, ensureUnbilledPeriod } from '../db'
import { formatRupiah, formatDateShort, OWNER_COLOR_CLASSES } from '../lib/format'
import type { BillPeriod, Payment, Transaction, Expense, Owner, PaymentAllocation } from '../types'

export default function Payments() {
  const periods = useLiveQuery(
    () => db.periods.orderBy('year').reverse().filter((p) => p.type !== 'unbilled').toArray(),
    []
  ) ?? []
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const activePeriodId = selectedPeriodId || periods[0]?.id || ''

  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []

  // Payment sources scoped to the active period (for the summary cards)
  // Include all non-hidden negative-amount (credit) transactions — covers both
  // correctly-typed 'payment' rows and payments that Claude classified as 'other'
  const paymentTxs = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.transactions
      .where('periodId').equals(activePeriodId)
      .filter((t) => !t.hidden && t.amount < 0)
      .toArray()
  }, [activePeriodId]) ?? []

  const manualPayments = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.payments.where('periodId').equals(activePeriodId).toArray()
  }, [activePeriodId]) ?? []

  // Period-scoped charges + expenses (for summary / status-by-owner)
  const chargeTxs = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.transactions
      .where('periodId').equals(activePeriodId)
      .filter((t) => !t.hidden && t.amount > 0)
      .toArray()
  }, [activePeriodId]) ?? []

  const expenses = useLiveQuery(async () => {
    if (!activePeriodId) return []
    const txIds = (await db.transactions.where('periodId').equals(activePeriodId).toArray()).map((t) => t.id)
    return db.expenses.where('transactionId').anyOf(txIds).toArray()
  }, [activePeriodId]) ?? []

  // ALL charges + expenses across every period (for the AllocationSheet)
  const allChargeTxs = useLiveQuery(async () => {
    return db.transactions.filter((t) => !t.hidden && t.amount > 0).toArray()
  }, []) ?? []

  const allExpenses = useLiveQuery(() => db.expenses.toArray(), []) ?? []

  const allAllocations = useLiveQuery(() => db.paymentAllocations.toArray(), []) ?? []

  const totalPayments =
    paymentTxs.reduce((s, t) => s + Math.abs(t.amount), 0) +
    manualPayments.reduce((s, p) => s + p.amount, 0)
  const totalCharges = chargeTxs.reduce((s, t) => s + t.amount, 0)

  const [allocatingId, setAllocatingId] = useState<string | null>(null)
  const [showAddPayment, setShowAddPayment] = useState(false)

  const allocatingPayment = allocatingId ? paymentTxs.find((t) => t.id === allocatingId) ?? null : null
  const allocatingManual = allocatingId ? manualPayments.find((p) => p.id === allocatingId) ?? null : null
  const allocatingAmount = allocatingPayment
    ? Math.abs(allocatingPayment.amount)
    : allocatingManual?.amount ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-700 text-white px-4 py-4">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold">Payments</h1>
          <select
            value={activePeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="bg-blue-800 text-white text-sm rounded-lg px-2 py-1.5 border border-blue-600"
          >
            <option value={UNBILLED_PERIOD_ID}>⏳ Unbilled Pool</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-blue-200">{activePeriodId === UNBILLED_PERIOD_ID ? 'Pending: ' : 'Total bill: '}</span>
            <span className="font-semibold">{formatRupiah(totalCharges)}</span>
          </div>
          <div>
            <span className="text-blue-200">Paid: </span>
            <span className="font-semibold text-green-300">{formatRupiah(totalPayments)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Credit / payment transactions from the selected period */}
        {paymentTxs.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Credits &amp; Payments
            </p>
            <div className="space-y-2">
              {paymentTxs.map((tx) => {
                const allocated = allAllocations
                  .filter((a) => a.paymentId === tx.id)
                  .reduce((s, a) => s + a.amount, 0)
                const unallocated = Math.abs(tx.amount) - allocated
                return (
                  <div key={tx.id} className="bg-white rounded-xl shadow-sm p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="text-xs text-gray-400">{formatDateShort(tx.date)}</p>
                        <p className="text-sm font-medium text-green-700">{formatRupiah(Math.abs(tx.amount))}</p>
                        {tx.description && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">{tx.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setAllocatingId(tx.id)}
                        className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2 py-1 flex-shrink-0"
                      >
                        Allocate
                      </button>
                    </div>
                    {unallocated > 0 ? (
                      <p className="text-xs text-amber-600">{formatRupiah(unallocated)} unallocated</p>
                    ) : (
                      <p className="text-xs text-green-600">Fully allocated ✓</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Manual payments */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Manual Payments
            </p>
            <button onClick={() => setShowAddPayment(true)} className="text-xs text-blue-600">
              + Add
            </button>
          </div>
          {manualPayments.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No manual payments recorded</p>
          )}
          <div className="space-y-2">
            {manualPayments.map((payment) => {
              const allocated = allAllocations
                .filter((a) => a.paymentId === payment.id)
                .reduce((s, a) => s + a.amount, 0)
              const unallocated = payment.amount - allocated
              return (
                <div key={payment.id} className="bg-white rounded-xl shadow-sm p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-xs text-gray-400">{formatDateShort(payment.date)}</p>
                      <p className="text-sm font-medium text-green-700">{formatRupiah(payment.amount)}</p>
                      {payment.note && <p className="text-xs text-gray-500">{payment.note}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAllocatingId(payment.id)}
                        className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2 py-1"
                      >
                        Allocate
                      </button>
                      <button
                        onClick={() => db.payments.delete(payment.id)}
                        className="text-xs text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {unallocated > 0 ? (
                    <p className="text-xs text-amber-600">{formatRupiah(unallocated)} unallocated</p>
                  ) : (
                    <p className="text-xs text-green-600">Fully allocated ✓</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Status by owner */}
        {owners.length > 0 && (
          <section className="bg-white rounded-xl shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Status by Owner</p>
            {owners.map((owner) => {
              const c = OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue
              const ownerExpenses = expenses.filter((e) => e.ownerId === owner.id)
              const ownerTotal = chargeTxs
                .filter((t) => ownerExpenses.find((e) => e.transactionId === t.id))
                .reduce((s, t) => s + t.amount, 0)
              const ownerPaid = ownerExpenses
                .filter((e) => e.status === 'paid' || e.status === 'partial')
                .reduce((s, e) => {
                  const tx = chargeTxs.find((t) => t.id === e.transactionId)
                  return s + (tx?.amount ?? 0)
                }, 0)
              if (ownerTotal === 0) return null
              return (
                <div key={owner.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                    {owner.name}
                  </span>
                  <div className="text-right text-xs">
                    <p className="text-gray-900 font-medium">{formatRupiah(ownerTotal)}</p>
                    <p className="text-gray-400">paid {formatRupiah(ownerPaid)}</p>
                  </div>
                </div>
              )
            })}
          </section>
        )}
      </div>

      {allocatingId && (
        <AllocationSheet
          paymentId={allocatingId}
          paymentAmount={allocatingAmount}
          periods={periods}
          allExpenses={allExpenses}
          allChargeTxs={allChargeTxs}
          owners={owners}
          allAllocations={allAllocations}
          onClose={() => setAllocatingId(null)}
        />
      )}

      {showAddPayment && (
        <AddPaymentSheet
          periods={periods}
          defaultPeriodId={activePeriodId}
          onClose={() => setShowAddPayment(false)}
        />
      )}
    </div>
  )
}

// ── Allocation sheet (cross-period) ─────────────────────────────
function AllocationSheet({
  paymentId,
  paymentAmount,
  periods,
  allExpenses,
  allChargeTxs,
  owners,
  allAllocations,
  onClose,
}: {
  paymentId: string
  paymentAmount: number
  periods: BillPeriod[]
  allExpenses: Expense[]
  allChargeTxs: Transaction[]
  owners: Owner[]
  allAllocations: PaymentAllocation[]
  onClose: () => void
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    allAllocations
      .filter((a) => a.paymentId === paymentId)
      .forEach((a) => { m[a.expenseId] = String(a.amount) })
    return m
  })
  const [saving, setSaving] = useState(false)

  // Transactions that have a labeled expense, across all periods
  const txsWithExpense = allChargeTxs.filter((t) =>
    allExpenses.find((e) => e.transactionId === t.id)
  )

  // Unbilled pool transactions with expenses
  const unbilledTxs = txsWithExpense.filter((t) => t.periodId === UNBILLED_PERIOD_ID)

  // Group by period
  const groups: { period: BillPeriod; txs: Transaction[] }[] = periods
    .map((p) => ({
      period: p,
      txs: txsWithExpense.filter((t) => t.periodId === p.id),
    }))
    .filter((g) => g.txs.length > 0)

  const totalEntered = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0)
  const remaining = paymentAmount - totalEntered

  function allocatedByOthers(expenseId: string) {
    return allAllocations
      .filter((a) => a.expenseId === expenseId && a.paymentId !== paymentId)
      .reduce((s, a) => s + a.amount, 0)
  }

  function handleFill(expenseId: string, txAmount: number) {
    const byOthers = allocatedByOthers(expenseId)
    const maxForExpense = Math.max(0, txAmount - byOthers)
    const currentEntry = Number(amounts[expenseId]) || 0
    const fill = Math.min(maxForExpense, Math.max(0, remaining + currentEntry))
    setAmounts((prev) => ({ ...prev, [expenseId]: fill > 0 ? String(fill) : '' }))
  }

  async function save() {
    setSaving(true)
    for (const tx of txsWithExpense) {
      const expense = allExpenses.find((e) => e.transactionId === tx.id)!
      const enteredAmt = Number(amounts[expense.id]) || 0
      const existing = allAllocations.find(
        (a) => a.paymentId === paymentId && a.expenseId === expense.id
      )

      if (enteredAmt > 0) {
        await db.paymentAllocations.put({
          id: existing?.id ?? generateId(),
          paymentId,
          expenseId: expense.id,
          amount: enteredAmt,
        })
      } else if (existing) {
        await db.paymentAllocations.delete(existing.id)
      }

      // Recalculate expense status
      const byOthers = allocatedByOthers(expense.id)
      const totalAlloc = byOthers + enteredAmt
      const status: 'paid' | 'partial' | 'unpaid' =
        totalAlloc >= tx.amount ? 'paid' : totalAlloc > 0 ? 'partial' : 'unpaid'
      await db.expenses.update(expense.id, { status })
    }
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Allocate Payment</h3>
            <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
          </div>
          <p className="text-sm text-green-600 font-medium mt-1">{formatRupiah(paymentAmount)}</p>
          <div className="flex gap-4 text-xs mt-0.5">
            <span className="text-gray-400">
              Allocated:{' '}
              <span className={totalEntered > paymentAmount ? 'text-red-500 font-medium' : 'text-gray-700'}>
                {formatRupiah(totalEntered)}
              </span>
            </span>
            <span className="text-gray-400">
              Remaining:{' '}
              <span className={remaining < 0 ? 'text-red-500 font-medium' : 'text-green-600 font-medium'}>
                {remaining < 0 ? '-' : ''}{formatRupiah(Math.abs(remaining))}
                {remaining < 0 ? ' (over)' : ''}
              </span>
            </span>
          </div>
        </div>

        {/* Grouped expense list */}
        <div className="overflow-y-auto flex-1">
          {groups.length === 0 && unbilledTxs.length === 0 && (
            <p className="text-sm text-gray-400 px-4 py-6 text-center">
              No labeled expenses found in any period.<br />Label transactions first.
            </p>
          )}

          {/* Unbilled pool section */}
          {unbilledTxs.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-orange-50 border-y border-orange-100 sticky top-0">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                  ⏳ Unbilled Pool (Pending)
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {unbilledTxs.map((tx) => {
                  const expense = allExpenses.find((e) => e.transactionId === tx.id)!
                  const owner = owners.find((o) => o.id === expense.ownerId)
                  const c = owner
                    ? (OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue)
                    : OWNER_COLOR_CLASSES.blue
                  const byOthers = allocatedByOthers(expense.id)
                  const maxForExpense = Math.max(0, tx.amount - byOthers)
                  const fullyPaidByOthers = byOthers >= tx.amount
                  const currentEntry = Number(amounts[expense.id]) || 0
                  const fillPreview = Math.min(maxForExpense, Math.max(0, remaining + currentEntry))

                  return (
                    <div key={tx.id} className={`px-4 py-3 ${fullyPaidByOthers ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{expense.label || tx.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{formatDateShort(tx.date)}</span>
                            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Pending</span>
                            {owner && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                                {owner.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-gray-900">{formatRupiah(tx.amount)}</p>
                          {byOthers > 0 && (
                            <p className="text-xs text-gray-400">{formatRupiah(byOthers)} other pmts</p>
                          )}
                        </div>
                      </div>
                      {fullyPaidByOthers ? (
                        <p className="text-xs text-green-600 font-medium">Fully covered by other payments</p>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            value={amounts[expense.id] ?? ''}
                            onChange={(e) =>
                              setAmounts((prev) => ({ ...prev, [expense.id]: e.target.value }))
                            }
                            placeholder="0"
                            min={0}
                            max={maxForExpense}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => handleFill(expense.id, tx.amount)}
                            disabled={fillPreview <= 0}
                            className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2 py-1.5 flex-shrink-0 disabled:opacity-40"
                          >
                            Fill {formatRupiah(fillPreview)}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {groups.map(({ period, txs }) => (
            <div key={period.id}>
              {/* Period header */}
              <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 sticky top-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {period.label}
                </p>
              </div>

              <div className="divide-y divide-gray-50">
                {txs.map((tx) => {
                  const expense = allExpenses.find((e) => e.transactionId === tx.id)!
                  const owner = owners.find((o) => o.id === expense.ownerId)
                  const c = owner
                    ? (OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue)
                    : OWNER_COLOR_CLASSES.blue
                  const byOthers = allocatedByOthers(expense.id)
                  const maxForExpense = Math.max(0, tx.amount - byOthers)
                  const fullyPaidByOthers = byOthers >= tx.amount
                  const currentEntry = Number(amounts[expense.id]) || 0
                  const fillPreview = Math.min(maxForExpense, Math.max(0, remaining + currentEntry))

                  return (
                    <div key={tx.id} className={`px-4 py-3 ${fullyPaidByOthers ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{expense.label || tx.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{formatDateShort(tx.date)}</span>
                            {owner && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                                {owner.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-gray-900">{formatRupiah(tx.amount)}</p>
                          {byOthers > 0 && (
                            <p className="text-xs text-gray-400">{formatRupiah(byOthers)} other pmts</p>
                          )}
                        </div>
                      </div>

                      {fullyPaidByOthers ? (
                        <p className="text-xs text-green-600 font-medium">Fully covered by other payments</p>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            value={amounts[expense.id] ?? ''}
                            onChange={(e) =>
                              setAmounts((prev) => ({ ...prev, [expense.id]: e.target.value }))
                            }
                            placeholder="0"
                            min={0}
                            max={maxForExpense}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => handleFill(expense.id, tx.amount)}
                            disabled={fillPreview <= 0}
                            className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2 py-1.5 flex-shrink-0 disabled:opacity-40"
                          >
                            Fill {formatRupiah(fillPreview)}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4 flex-shrink-0">
          {remaining < 0 && (
            <p className="text-xs text-red-500 mb-2 text-center">
              Total exceeds payment by {formatRupiah(Math.abs(remaining))}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-3 text-sm">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || remaining < 0}
              className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Allocations'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add manual payment ──────────────────────────────────────────
function AddPaymentSheet({
  periods,
  defaultPeriodId,
  onClose,
}: {
  periods: BillPeriod[]
  defaultPeriodId: string
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [periodId, setPeriodId] = useState(defaultPeriodId)

  async function save() {
    const amt = Number(amount.replace(/[^0-9]/g, ''))
    if (!amt || !periodId) return
    if (periodId === UNBILLED_PERIOD_ID) await ensureUnbilledPeriod()
    await db.payments.add({ id: generateId(), periodId, date, amount: amt, note })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-900 mb-4">Add Manual Payment</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-600">Amount (IDR)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1500000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Bill Period</label>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
            >
              <option value={UNBILLED_PERIOD_ID}>⏳ Unbilled Pool</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Which bill does this payment cover?</p>
          </div>
          <div>
            <label className="text-sm text-gray-600">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Paid via BCA Mobile"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mt-1"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-3 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
