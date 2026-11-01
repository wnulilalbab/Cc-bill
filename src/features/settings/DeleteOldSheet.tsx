// Delete old data: confirm → the JSON backup downloads → the old database is deleted.
import { useState } from 'react'
import { deleteOldData, type OldBackup } from '../../data/migration'
import { Sheet } from '../../components/Sheet'
import { useData } from '../data/DataContext'
import { downloadText } from './format'

export interface DeleteOldSheetProps {
  onClose(): void
  onDeleted(backup: OldBackup): void
  /** Saves the backup file; the delete only happens once this returns. Defaults to a browser download. */
  save?: (backup: OldBackup) => void | Promise<void>
}

export function DeleteOldSheet({ onClose, onDeleted, save = (b) => downloadText(b.fileName, b.json) }: DeleteOldSheetProps) {
  const { db, oldName } = useData()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const backup = await deleteOldData(db, { oldName, beforeDelete: save })
      onDeleted(backup)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Sheet title="Delete old data?" onClose={onClose}>
      <div className="small">
        A JSON backup of the old data downloads first. Only after that is the old database removed from this phone. Your migrated data is not touched.
      </div>
      {error && (
        <div className="err" role="alert">
          Nothing was deleted. {error}
        </div>
      )}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={go}>
          Download backup and delete
        </button>
      </div>
    </Sheet>
  )
}
