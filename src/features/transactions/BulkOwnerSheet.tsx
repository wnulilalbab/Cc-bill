// "Set owner" on the selected rows. Like a rule apply (Slice 7): rows a payment covers are skipped with a note
// (changed one by one, where Keep / Unassign is asked), and rows tagged by hand change only when the user ticks the box.
import { useEffect, useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import type { OwnerRecord } from '../../data/cards'
import { bulkSetOwner, previewBulkOwner, type BulkOwnerPreview } from '../../data/transactions'
import { useData } from '../data/DataContext'

const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`

export interface BulkOwnerSheetProps {
  txIds: readonly string[]
  owners: readonly OwnerRecord[]
  onClose(): void
  onDone(): void
}

export function BulkOwnerSheet({ txIds, owners, onClose, onDone }: BulkOwnerSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [preview, setPreview] = useState<BulkOwnerPreview | null>(null)
  const [includeManual, setIncludeManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerId) return
    let live = true
    setPreview(null)
    previewBulkOwner(db, txIds, ownerId).then(
      (p) => live && setPreview(p),
      (e: unknown) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [db, txIds, ownerId])

  const n = preview ? preview.change.length + (includeManual ? preview.manual.length : 0) : 0
  const name = owners.find((o) => o.id === ownerId)?.name ?? ''

  async function apply() {
    setBusy(true)
    try {
      const r = await bulkSetOwner(db, txIds, ownerId, { includeManual })
      const notes = [r.paidSkipped && `${rows(r.paidSkipped)} with a payment skipped`, r.manualSkipped && `${rows(r.manualSkipped)} set by you kept`].filter(Boolean)
      toast(`${name} set on ${rows(r.changed)}${notes.length ? `. ${notes.join('; ')}.` : ''}`)
      onDone()
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Set owner of ${rows(txIds.length)}`} onClose={onClose}>
      <div className="chips" role="group" aria-label="Who pays">
        {owners
          .filter((o) => !o.archived)
          .map((o) => (
            <button key={o.id} type="button" className="chip" aria-pressed={ownerId === o.id} onClick={() => setOwnerId(o.id)}>
              {o.name}
            </button>
          ))}
      </div>
      {ownerId && !preview && !error && <div className="small muted">Counting…</div>}
      {preview && (
        <div className="box tight" aria-label="Bulk preview">
          <div className="small">{preview.change.length ? `${rows(preview.change.length)} will change to ${name}.` : 'No rows to change.'}</div>
          {preview.unchanged > 0 && <div className="small muted">{rows(preview.unchanged)} already {name}&apos;s.</div>}
          {preview.paid > 0 && <div className="small muted">{rows(preview.paid)} with a payment left as they are; change them one by one.</div>}
          {preview.manual.length > 0 && (
            <label className="small">
              <input type="checkbox" checked={includeManual} onChange={(e) => setIncludeManual(e.target.checked)} /> Also change {rows(preview.manual.length)} you tagged by hand
            </label>
          )}
        </div>
      )}
      {error && <div className="small err">{error}</div>}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn acc" disabled={busy || n === 0} onClick={apply}>
          Apply to {rows(n)}
        </button>
      </div>
    </Sheet>
  )
}
