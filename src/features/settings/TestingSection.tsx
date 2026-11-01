// Settings → Testing: testing-mode tools (docs/intent/phase-1.md §10). Hidden until testing mode is on.
import { useState } from 'react'
import { clearAiCache } from '../../data/aiCache'
import { DATA_TABLES, type DataTable } from '../../data/db'
import { MIGRATED_CARD } from '../../data/migration'
import { deleteRow, inspectRecord, loadDemoData, rerunMigration, resetNewData } from '../../data/testing'
import { Picker } from '../../components/Picker'
import { useToast } from '../../components/Toast'
import { useData } from '../data/DataContext'
import { PREF_KEYS, prefGet, prefSet } from '../look/prefs'

const TABLE_LABELS: Record<DataTable, string> = {
  cards: 'Cards',
  owners: 'Owners',
  statements: 'Statements',
  transactions: 'Transactions',
  payments: 'Payments',
  plans: 'Installment plans',
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function TestingSection({ onChanged }: { onChanged(): void }) {
  const { db, oldName } = useData()
  const toast = useToast()
  const [on, setOn] = useState(() => prefGet(PREF_KEYS.testingMode) === '1')
  const [confirmReset, setConfirmReset] = useState(false)
  const [table, setTable] = useState<DataTable>('transactions')
  const [id, setId] = useState('')
  const [record, setRecord] = useState<{ table: DataTable; id: string; json: string | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<string>) {
    setBusy(true)
    try {
      toast(await work())
      onChanged()
    } catch (e) {
      toast(message(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = () => {
    const next = !on
    setOn(next)
    prefSet(PREF_KEYS.testingMode, next ? '1' : null)
  }

  const verified = (ok: boolean) => (ok ? 'verified ✓' : 'did not verify')

  return (
    <>
      <div className="lbl">Testing</div>
      <div className="box tight">
        <label className="row small">
          <span>Testing mode</span>
          <input type="checkbox" role="switch" checked={on} onChange={toggle} aria-label="Testing mode" />
        </label>
        {on && (
          <>
            <div className="xs muted">Tools for trying things out. They only touch the new data; the old data is never changed here.</div>
            {confirmReset ? (
              <div className="status draft">
                <div className="small">
                  <b>Reset new data?</b> Every card, statement and payment in the new database is removed. The old data stays.
                </div>
                <div className="btns">
                  <button type="button" className="btn ghost sm" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirmReset(false)
                      void run(async () => {
                        await resetNewData(db)
                        return 'New data reset'
                      })
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => setConfirmReset(true)}>
                Reset new data
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const card = await db.cards.get(MIGRATED_CARD.id)
                  const v = await rerunMigration(db, { defaultOwnerId: card?.defaultOwnerId ?? null }, oldName)
                  return `Migration re-run: ${verified(v.ok)}`
                })
              }
            >
              Re-run migration
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => run(async () => `Demo data loaded: ${verified((await loadDemoData(db)).ok)}`)}
            >
              Load demo data
            </button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => `AI cache cleared (${await clearAiCache(db)} removed)`)}>
              Clear AI cache
            </button>

            <div className="field">
              <span className="fl">Inspect a record</span>
              <div className="btns">
                <Picker title="Table" field value={table} options={DATA_TABLES.map((t) => ({ value: t, label: TABLE_LABELS[t] }))} onChange={(v) => setTable(v as DataTable)} />
                <input className="inp" aria-label="Record id" placeholder="Record id" value={id} onChange={(e) => setId(e.target.value)} />
              </div>
              <button
                type="button"
                className="btn ghost sm"
                disabled={!id.trim()}
                onClick={async () => {
                  const r = await inspectRecord(db, table, id.trim())
                  setConfirmDelete(false)
                  setRecord({ table, id: id.trim(), json: r ? JSON.stringify(r, null, 2) : null })
                }}
              >
                Inspect
              </button>
            </div>
            {record &&
              (record.json === null ? (
                <div className="small muted">
                  No {TABLE_LABELS[record.table].toLowerCase()} record with id &quot;{record.id}&quot;.
                </div>
              ) : (
                <>
                  <pre className="inspect" aria-label="Record">
                    {record.json}
                  </pre>
                  {confirmDelete ? (
                    <div className="btns">
                      <button type="button" className="btn ghost sm" onClick={() => setConfirmDelete(false)}>
                        Keep it
                      </button>
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() =>
                          run(async () => {
                            await deleteRow(db, record.table, record.id)
                            setRecord(null)
                            setConfirmDelete(false)
                            return 'Record deleted'
                          })
                        }
                      >
                        Delete record
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn danger sm" onClick={() => setConfirmDelete(true)}>
                      Delete this record
                    </button>
                  )}
                </>
              ))}
          </>
        )}
      </div>
    </>
  )
}
