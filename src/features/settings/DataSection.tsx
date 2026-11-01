// Settings → Data: Migrate old data, Delete old data.
import { useCallback, useEffect, useState } from 'react'
import { lastVerification, MIGRATED_CARD, type VerificationRecord } from '../../data/migration'
import { fingerprint, readOldData, type OldData } from '../../data/old'
import { useToast } from '../../components/Toast'
import { useData } from '../data/DataContext'
import { DeleteOldSheet } from './DeleteOldSheet'
import { MigrateSheet } from './MigrateSheet'

type OldState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; old: OldData | null; verification: VerificationRecord | undefined; defaultOwnerId: string | null }

/** Reads the old database and the last verification. `version` re-reads when it changes. */
export function useOldState(version: number): [OldState, () => void] {
  const { db, oldName } = useData()
  const [state, setState] = useState<OldState>({ kind: 'loading' })
  const [n, setN] = useState(0)
  const reload = useCallback(() => setN((x) => x + 1), [])
  useEffect(() => {
    let live = true
    Promise.all([readOldData(oldName), lastVerification(db), db.cards.get(MIGRATED_CARD.id)])
      .then(([old, verification, card]) => {
        if (live) setState({ kind: 'ready', old, verification, defaultOwnerId: card?.defaultOwnerId ?? null })
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      live = false
    }
  }, [db, oldName, n, version])
  return [state, reload]
}

export function DataSection({ version, onChanged }: { version: number; onChanged(): void }) {
  const toast = useToast()
  const [state, reload] = useOldState(version)
  const [sheet, setSheet] = useState<'migrate' | 'delete' | null>(null)

  const changed = () => {
    reload()
    onChanged()
  }

  let body
  if (state.kind === 'loading') body = <div className="small muted">Looking for old data…</div>
  else if (state.kind === 'error') body = <div className="err" role="alert">The old data could not be read: {state.message}</div>
  else {
    const { old, verification } = state
    const verified = !!old && !!verification?.ok && verification.oldFingerprint === fingerprint(old)
    if (!old) body = <div className="small">{verification?.ok ? 'Old data deleted. Everything is in the new database.' : 'No old data on this phone.'}</div>
    else if (verified)
      body = (
        <>
          <div className="small">Old data migrated ✓ and kept as a backup.</div>
          <button type="button" className="btn danger sm" onClick={() => setSheet('delete')}>
            Delete old data (downloads a backup first)
          </button>
        </>
      )
    else
      body = (
        <>
          <div className="small">
            Old data found: {old.transactions.length} transactions, {old.owners.length} owners.
          </div>
          {verification && !verification.ok && <div className="small warn-text">The last migration did not verify. Run it again.</div>}
          {verification?.ok && <div className="small warn-text">The old data changed after it was migrated. Run the migration again.</div>}
          <button type="button" className="btn sm" onClick={() => setSheet('migrate')}>
            Migrate old data
          </button>
        </>
      )
  }

  return (
    <>
      <div className="lbl">Data</div>
      <div className="box tight">{body}</div>
      {sheet === 'migrate' && state.kind === 'ready' && state.old && (
        <MigrateSheet old={state.old} initialDefaultOwnerId={state.defaultOwnerId} onClose={() => setSheet(null)} onMigrated={changed} />
      )}
      {sheet === 'delete' && (
        <DeleteOldSheet
          onClose={() => setSheet(null)}
          onDeleted={() => {
            setSheet(null)
            changed()
            toast('Backup downloaded, old data deleted')
          }}
        />
      )}
    </>
  )
}
