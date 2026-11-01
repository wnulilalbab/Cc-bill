// "+ Add a missing transaction" to the selected statement (or Unbilled). Source You; the totals check re-runs.
import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import type { Statement, TxKind } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import { addRow, RowError } from '../../data/transactions'
import { useData } from '../data/DataContext'
import { parseAmount } from '../settings/format'
import { signedFor, statementName } from './view'

const KINDS: { value: TxKind; label: string }[] = [
  { value: 'purchase', label: 'Charge' },
  { value: 'refund', label: 'Refund' },
  { value: 'fee', label: 'Fee' },
  { value: 'interest', label: 'Interest' },
]

export interface AddRowSheetProps {
  statement: Statement
  owners: readonly OwnerRecord[]
  defaultOwnerId: string | null
  /** Pre-filled date (today, or the statement date). */
  date: string
  onClose(): void
}

export function AddRowSheet({ statement, owners, defaultOwnerId, date: initialDate, onClose }: AddRowSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(initialDate)
  const [description, setDescription] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TxKind>('purchase')
  const [ownerId, setOwnerId] = useState<string | null>(defaultOwnerId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const abs = parseAmount(amount)
    if (abs === null || !description.trim()) return setError('Add an amount and a description.')
    setBusy(true)
    try {
      await addRow(db, { statementId: statement.id, date, description, amount: signedFor(kind, abs), kind, ownerId, label })
      toast(statement.kind === 'billed' ? 'Added. Totals check updated.' : 'Added')
      onClose()
    } catch (e) {
      setError(e instanceof RowError ? e.message : `Could not save: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add a missing transaction" onClose={onClose}>
      <div className="xs muted">Goes to {statementName(statement)}. The totals check runs again after you save.</div>
      <div className="chips" role="group" aria-label="Kind">
        {KINDS.map((k) => (
          <button key={k.value} type="button" className="chip" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="btns">
        <div className="field">
          <label htmlFor="newAmount">Amount</label>
          <input className="inp num" id="newAmount" inputMode="numeric" value={amount} data-autofocus="" onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="newDate">Date</label>
          <input className="inp" id="newDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="newDesc">Description</label>
        <input className="inp" id="newDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <span className="fl">Who pays</span>
        <div className="chips" role="group" aria-label="Who pays">
          {owners
            .filter((o) => !o.archived)
            .map((o) => (
              <button key={o.id} type="button" className="chip" aria-pressed={ownerId === o.id} onClick={() => setOwnerId(o.id)}>
                {o.name}
              </button>
            ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="newLabel">Label</label>
        <input className="inp" id="newLabel" value={label} placeholder="Optional" onChange={(e) => setLabel(e.target.value)} />
      </div>
      {error && <div className="small err">{error}</div>}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn acc" disabled={busy} onClick={save}>
          Add
        </button>
      </div>
    </Sheet>
  )
}
