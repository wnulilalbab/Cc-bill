// Migrate old data: preview every adjustment → Confirm → verification result (docs/intent/phase-1.md §10).
import { useMemo, useState } from 'react'
import { migrate, MIGRATED_CARD, planMigration, type MigrationCounts, type MigrationPlan, type MigrationTotals, type Verification } from '../../data/migration'
import { MigrationError, type OldData } from '../../data/old'
import { Picker } from '../../components/Picker'
import { Sheet } from '../../components/Sheet'
import { useData } from '../data/DataContext'
import { rp } from './format'

const COUNT_LABELS: Record<keyof MigrationCounts, string> = {
  owners: 'Owners',
  statements: 'Statements (incl. Unbilled)',
  transactions: 'Transactions',
  bankPayments: 'Payment lines on statements',
  manualPayments: 'Payments recorded by hand',
  plans: 'Installment plans',
  allocations: 'Payment assignments',
}
const TOTAL_LABELS: Record<keyof MigrationTotals, string> = {
  charges: 'Total charged',
  credits: 'Total credits and payments',
  manualPayments: 'Total recorded by hand',
  allocated: 'Total assigned',
}

const isUnknown = (name: string) => name.trim().toLowerCase() === 'unknown'

export interface MigrateSheetProps {
  old: OldData
  /** Pre-selected default owner (old owner id). */
  initialDefaultOwnerId?: string | null
  onClose(): void
  /** Called after the migration ran (whether or not it verified). */
  onMigrated(v: Verification): void
}

export function MigrateSheet({ old, initialDefaultOwnerId = null, onClose, onMigrated }: MigrateSheetProps) {
  const { db } = useData()
  const [defaultOwnerId, setDefaultOwnerId] = useState<string | null>(() =>
    old.owners.some((o) => o.id === initialDefaultOwnerId && !isUnknown(o.name)) ? initialDefaultOwnerId : null,
  )
  const [statementDay, setStatementDay] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Verification | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const day = statementDay === '' ? undefined : Number(statementDay)
  const planned = useMemo((): { plan: MigrationPlan } | { error: string } => {
    try {
      return { plan: planMigration(old, { defaultOwnerId, statementDay: day }) }
    } catch (e) {
      return { error: e instanceof MigrationError ? e.message : String(e) }
    }
  }, [old, defaultOwnerId, day])

  async function confirm() {
    if (!('plan' in planned)) return
    setRunning(true)
    try {
      const v = await migrate(db, old, planned.plan)
      setResult(v)
      onMigrated(v)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  if (result) return <VerificationView v={result} onClose={onClose} />

  const ownerOptions = [
    { value: '', label: 'None', sub: 'Rows tagged "Unknown" get no owner, only Check' },
    ...old.owners.filter((o) => !isUnknown(o.name)).map((o) => ({ value: o.id, label: o.name })),
  ]
  const data = 'plan' in planned ? planned.plan.data : null

  return (
    <Sheet title="Migration preview" onClose={onClose}>
      {data && (
        <div className="box tight">
          <Row label="Transactions" value={data.transactions.length} />
          <Row label="Owners" value={data.owners.length} />
          <Row label="Installment plans" value={data.plans.length} />
          <Row label="Payment assignments" value={data.payments.reduce((n, p) => n + p.allocations.length, 0)} />
        </div>
      )}
      <div className="field">
        <span className="fl">Default owner of {MIGRATED_CARD.name}</span>
        <Picker title="Default owner" field value={defaultOwnerId ?? ''} options={ownerOptions} onChange={(v) => setDefaultOwnerId(v || null)} />
        <div className="xs muted">Rows tagged &quot;Unknown&quot; go to this owner and are marked Check. Fees and interest go here too.</div>
      </div>
      <div className="field">
        <label htmlFor="mDay">Statement day (optional)</label>
        <input className="inp" id="mDay" inputMode="numeric" maxLength={2} placeholder="Blank = the last row date of each statement" value={statementDay} onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, ''))} />
      </div>
      {'error' in planned ? (
        <div className="err" role="alert">
          {planned.error}
        </div>
      ) : (
        <>
          <div className="lbl">Needs your OK · {planned.plan.adjustments.length}</div>
          <ul className="adjustments" aria-label="Adjustments">
            {planned.plan.adjustments.map((a, i) => (
              <li key={i} className="box tight small">
                {a.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {runError && (
        <div className="err" role="alert">
          The migration stopped: {runError}
        </div>
      )}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn acc" disabled={!data || running} onClick={confirm}>
          {running ? 'Migrating…' : 'Confirm and migrate'}
        </button>
      </div>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="row small">
      <span>{label}</span>
      <b className="num">{value}</b>
    </div>
  )
}

export function VerificationView({ v, onClose }: { v: Verification; onClose(): void }) {
  const counts = Object.keys(COUNT_LABELS) as (keyof MigrationCounts)[]
  const totals = Object.keys(TOTAL_LABELS) as (keyof MigrationTotals)[]
  return (
    <Sheet title="Migration done" onClose={onClose}>
      <div className={`status ${v.ok ? 'final' : 'draft'}`}>
        <h3>{v.ok ? 'Everything matches ✓' : `Verification found ${v.differences.length} difference${v.differences.length === 1 ? '' : 's'}`}</h3>
        {counts.map((k) => (
          <Row key={k} label={`${COUNT_LABELS[k]} old / new`} value={`${v.expected.counts[k]} / ${v.actual.counts[k]}`} />
        ))}
        {totals.map((k) => (
          <Row key={k} label={TOTAL_LABELS[k]} value={v.expected.totals[k] === v.actual.totals[k] ? 'Same to the rupiah' : `${rp(v.expected.totals[k])} / ${rp(v.actual.totals[k])}`} />
        ))}
      </div>
      {!v.ok && (
        <ul className="adjustments" aria-label="Differences">
          {v.differences.map((d, i) => (
            <li key={i} className="box tight small">
              {d.check}: expected {String(d.expected)}, got {String(d.actual)}
            </li>
          ))}
        </ul>
      )}
      <div className="small muted">{v.ok ? 'The old data stays as a backup until you delete it.' : 'The old data is unchanged. Old data can only be deleted after a migration verifies.'}</div>
      <button type="button" className="btn acc" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}
