// Delete old data, in two deliberate steps (docs/intent/phase-1.md §10):
//   1. Download (or share) the JSON backup of the old database.
//   2. "I've saved the backup file — delete old data": only enabled after step 1 ran in this sheet.
// A browser cannot tell whether the file was really saved (iOS PWA, a cancelled save dialog), so the user confirms it.
import { useMemo, useState } from 'react'
import { deleteOldData, lastVerification, type OldBackup } from '../../data/migration'
import { MigrationError, oldBackupJson, readOldData } from '../../data/old'
import { Sheet } from '../../components/Sheet'
import { useData } from '../data/DataContext'
import { canShareFile, downloadText, jsonFile } from './format'

export type SaveMethod = 'download' | 'share'

export interface DeleteOldSheetProps {
  onClose(): void
  onDeleted(backup: OldBackup): void
  /** Saves the backup file. Defaults to a browser download, or the share sheet when `method` is "share". */
  save?: (backup: OldBackup, method: SaveMethod) => void | Promise<void>
  /** Clock, for tests. */
  now?: () => string
}

export async function defaultSave(b: OldBackup, method: SaveMethod): Promise<void> {
  if (method === 'share') await navigator.share({ files: [jsonFile(b.fileName, b.json)], title: b.fileName })
  else downloadText(b.fileName, b.json)
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function DeleteOldSheet({ onClose, onDeleted, save = defaultSave, now = () => new Date().toISOString() }: DeleteOldSheetProps) {
  const { db, oldName } = useData()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ at: string; backup: OldBackup } | null>(null)
  const shareable = useMemo(() => canShareFile(jsonFile('ccbill-old-backup.json', '{}')), [])

  async function saveBackup(method: SaveMethod) {
    setBusy(true)
    setError(null)
    try {
      const verification = await lastVerification(db)
      if (!verification?.ok) throw new MigrationError('Old data can only be deleted after a migration has passed verification.')
      const old = await readOldData(oldName)
      if (!old) throw new MigrationError('There is no old data to delete.')
      const at = now()
      const backup: OldBackup = { json: oldBackupJson(old, at), fileName: `ccbill-old-backup-${at.slice(0, 10)}.json` }
      await save(backup, method)
      setSaved({ at, backup })
    } catch (e) {
      setError(`The backup was not saved. ${message(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!saved) return
    setBusy(true)
    setError(null)
    try {
      const backup = await deleteOldData(db, {
        oldName,
        now: saved.at,
        beforeDelete: (b) => {
          // The file the user saved must be exactly the data being deleted.
          if (b.json !== saved.backup.json) throw new MigrationError('The old data changed after you saved the backup. Download it again.')
        },
      })
      onDeleted(backup)
    } catch (e) {
      setError(`Nothing was deleted. ${message(e)}`)
      setSaved(null)
      setBusy(false)
    }
  }

  return (
    <Sheet title="Delete old data?" onClose={onClose} locked={busy}>
      <div className="small">
        <b>Step 1.</b> Save a JSON backup of the old data. <b>Step 2.</b> Once the file is safely saved, delete the old database from this phone. Your
        migrated data is not touched.
      </div>
      <div className={shareable ? 'btns' : 'field'}>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => saveBackup('download')}>
          {saved ? 'Download backup again' : 'Download backup'}
        </button>
        {shareable && (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => saveBackup('share')}>
            Share backup file
          </button>
        )}
      </div>
      {saved && <div className="small">Backup ready: {saved.backup.fileName}. Check it is in your files before you go on.</div>}
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="btn danger" disabled={!saved || busy} onClick={remove}>
        I&apos;ve saved the backup file — delete old data
      </button>
      <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  )
}
