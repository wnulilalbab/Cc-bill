import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../db'
import { formatRupiah, formatDateShort, OWNER_COLOR_CLASSES } from '../lib/format'
import type { Payment, Transaction, Expense } from '../types'

export default function Payments() {
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const activePeriodId = selectedPeriodId || periods[0]?.id || ''

  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []

  // Payment transactions (from imported bills)
  const paymentTxs = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.transactions
      .where('periodId').equals(activePeriodId)
      .filter((t) => t.type === 'payment')
      .toArray()
  }, [activePeriodId]) ?? []

  // Manual payment pool entries
  const manualPayments = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.payments.where('periodId').equals(activePeriodId).toArray()
  }, [activePeriodId]) ?? []

  // All expenses in this period
  const expenses = useLiveQuery(async () => {
    if (!activePeriodId) return []
    const txIds = (await db.transactions.where('periodId').equals(activePeriodId).toArray()).map((t) => t.id)
    return db.expenses.where('transactionId').anyOf(txIds).toArray()
  }, [activePeriodId]) ?? []

  // Chargeable transactions (not payments, not hidden)
  const chargeTxs = useLiveQuery(async () => {
    if (!activePeriodId) return []
    return db.transactions
      .where('periodId').equals(activePeriodId)
      .filter((t) => !t.hidden && t.amount > 0)
      .toArray()
  }, [activePeriodId]) ?? []

  const allAllocations = useLiveQuery(() => db.paymentAllocations.toArray(), []) ?? []

  const expenseByTx = new Map(expenses.map((e) => [e.transactionId, e]))

  const totalPayments = paymentTxs.reduce((s, t) => s + Math.abs(t.amount), 0) +
    manualPayments.reduce((s, p) => s + p.amount, 0)

  const totalCharges = chargeTxs.reduce((s, t) => s + t.amount, 0)

  // Allocated amount per expense
  function getAllocatedForExpense(expenseId: string) {
    return allAllocations.filter((a) => a.expenseId === expenseId).reduce((s, a) => s + a.amount, 0)
  }

  // State for allocation sheet
  const [allocatingPaymentTxId, setAllocatingPaymentTxId] = useState<string | null>(null)
  const [allocatingManualId, setAllocatingManualId] = useState<string | null>(null)
  const [showAddPayment, setShowAddPayment] = useState(false)

  const allocatingPayment = allocatingPaymentTxId
    ? paymentTxs.find((t) => t.id === allocatingPaymentTxId)
    : null
  const allocatingManual = allocatingManualId
    ? manualPayments.find((p) => p.id === allocatingManualId)
    : null

  const allocatingAmount = allocatingPayment
    ? Math.abs(allocatingPayment.amount)
    : allocatingManual?.amount ?? 0

  const allocatedForCurrent = allocatingPaymentTxId
    ? allAllocations.filter((a) => {
        const expense = expenses.find((e) => e.id === a.expenseId)
        return a.paymentId === allocatingPaymentTxId && expense
      }).reduce((s, a) => s + a.amount, 0)
    : allocatingManualId
    ? allAllocations.filter((a) => a.paymentId === allocatingManualId).reduce((s, a) => s + a.amount, 0)
    : 0

  async function toggleAllocation(paymentId: string, expenseId: string, expenseAmount: number) {
    const existing = allAllocations.find(
      (a) => a.paymentId === paymentId && a.expenseId === expenseId
    )
    if (existing) {
      await db.paymentAllocations.delete(existing.id)
      await db.expenses.update(expenseId, { status: 'unpaid' })
    } else {
      await db.paymentAllocations.put({ id: generateId(), paymentId, expenseId, amount: expenseAmount })
      await db.expenses.update(expenseId, { status: 'paid' })
    }
  }

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
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-blue-200">Total bill: </span>
            <span className="font-semibold">{formatRupiah(totalCharges)}</span>
          </div>
          <div>
            <span className="text-blue-200">Paid: </span>
            <span className="font-semibold text-green-300">{formatRupiah(totalPayments)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Payment transactions from bill */}
        {paymentTxs.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              From Bill
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
                        <p className="text-sm font-medium text-green-700">{formatRupiah(tx.amount)}</p>
                      </div>
                      <button
                        onClick={() => setAllocatingPaymentTxId(tx.id)}
                        className="text-xs text-blue-600 border border-blue-200 rounded-lg px-2 py-1"
                      >
                        Allocate
                      </button>
                    </div>
                    {unallocated > 0 ? (
                      <p className="text-xs text-amber-600">Rp {unallocated.toLocaleString('id-ID')} unallocated</p>
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
            <button
              onClick={() => setShowAddPayment(true)}
              className="text-xs text-blue-600"
            >
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
                        onClick={() => setAllocatingManualId(payment.id)}
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
                    <p className="text-xs text-amber-600">Rp {unallocated.toLocaleString('id-ID')} unallocated</p>
                  ) : (
                    <p className="text-xs text-green-600">Fully allocated ✓</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Per-owner summary */}
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

      {/* Allocation Sheet */}
      {(allocatingPaymentTxId || allocatingManualId) && (
        <AllocationSheet
          paymentId={allocatingPaymentTxId ?? allocatingManualId ?? ''}
          paymentAmount={allocatingAmount}
          alreadyAllocated={allocatedForCurrent}
          expenses={expenses}
          transactions={chargeTxs}
          owners={owners}
          allAllocations={allAllocations}
          onToggle={toggleAllocation}
          onClose={() => { setAllocatingPaymentTxId(null); setAllocatingManualId(null) }}
        />
      )}

      {/* Add Manual Payment Sheet */}
      {showAddPayment && (
        <AddPaymentSheet
          periodId={activePeriodId}
          onClose={() => setShowAddPayment(false)}
        />
      )}
    </div>
  )
}

function AllocationSheet({
  paymentId,
  paymentAmount,
  alreadyAllocated,
  expenses,
  transactions,
  owners,
  allAllocations,
  onToggle,
  onClose,
}: {
  paymentId: string
  paymentAmount: number
  alreadyAllocated: number
  expenses: Expense[]
  transactions: Transaction[]
  owners: ReturnType<typeof useLiveQuery>
  allAllocations: ReturnType<typeof useLiveQuery>
  onToggle: (paymentId: string, expenseId: string, amount: number) => void
  onClose: () => void
}) {
  const ownersList = owners as Array<{ id: string; name: string; color: string }>
  const txsWithExpense = transactions.filter((t) => expenses.find((e) => e.transactionId === t.id))

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Allocate Payment</h3>
            <button onClick={onClose} className="text-gray-400 text-xl">×</button>
          </div>
          <p className="text-sm text-green-600 font-medium mt-1">{formatRupiah(paymentAmount)}</p>
          <p className="text-xs text-gray-400">
            Allocated: {formatRupiah(alreadyAllocated)} · Remaining: {formatRupiah(Math.max(0, paymentAmount - alreadyAllocated))}
          </p>
        </div>

        <div className="divide-y divide-gray-50">
          {txsWithExpense.map((tx) => {
            const expense = expenses.find((e) => e.transactionId === tx.id)!
            const owner = ownersList.find((o) => o.id === expense.ownerId)
            const c = owner ? (OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue) : OWNER_COLOR_CLASSES.blue
            const isAllocated = (allAllocations as ReturnType<typeof useLiveQuery> as Array<{ paymentId: string; expenseId: string }>).some(
              (a) => a.paymentId === paymentId && a.expenseId === expense.id
            )

            return (
              <button
                key={tx.id}
                onClick={() => onToggle(paymentId, expense.id, tx.amount)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left ${isAllocated ? 'bg-green-50' : ''}`}
              >
                <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${isAllocated ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                  {isAllocated && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{expense.label || tx.description}</p>
                  <p className="text-xs text-gray-400">{formatDateShort(tx.date)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-900">{formatRupiah(tx.amount)}</p>
                  {owner && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>{owner.name}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AddPaymentSheet({ periodId, onClose }: { periodId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  async function save() {
    const amt = Number(amount.replace(/[^0-9]/g, ''))
    if (!amt) return
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
          <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-3 text-sm">Cancel</button>
          <button onClick={save} className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  )
}
