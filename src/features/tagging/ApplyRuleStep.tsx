// After a rule is saved: how many existing rows it would change, then confirm. By default only rows that need a
// check or have no owner change; rows that already have another owner change only when the user ticks the box.
import { useEffect, useState } from 'react'
import type { RulePreview } from '../../domain/tagging/apply'
import { describeMatch } from '../../domain/tagging/rules'
import type { TagRule } from '../../domain/tagging/types'
import { applyRuleOnCard, previewRuleOnCard } from '../../data/rules'
import { useData } from '../data/DataContext'

const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`

export interface ApplyRuleStepProps {
  rule: TagRule
  ownerName: string
  /** The row the rule was made from (already tagged). */
  except?: string
  onDone(changed: number): void
}

export function ApplyRuleStep({ rule, ownerName, except, onDone }: ApplyRuleStepProps) {
  const { db } = useData()
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [includeOwned, setIncludeOwned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    previewRuleOnCard(db, rule, except).then(
      (p) => live && setPreview(p),
      (e: unknown) => live && setError(`Could not count the matching rows: ${String(e)}`),
    )
    return () => {
      live = false
    }
  }, [db, rule, except])

  if (error) return <div className="small err">{error}</div>
  if (!preview) return <div className="small muted">Counting matching rows…</div>

  const n = preview.unsure.length + (includeOwned ? preview.owned.length : 0)
  const title = `${describeMatch(rule)} → ${ownerName}`
  if (!preview.unsure.length && !preview.owned.length) {
    return (
      <div className="box tight" aria-label="Apply rule">
        <div className="small">
          <b>{title}</b>
        </div>
        <div className="small muted">No other rows match this rule.</div>
        <button type="button" className="btn acc" onClick={() => onDone(0)}>
          Done
        </button>
      </div>
    )
  }

  async function apply() {
    setBusy(true)
    try {
      onDone(await applyRuleOnCard(db, rule, { includeOwned, except }))
    } catch (e) {
      setError(`Could not apply the rule: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <div className="box tight" aria-label="Apply rule">
      <div className="small">
        <b>{title}</b>
      </div>
      <div className="small">
        {preview.unsure.length ? `${rows(preview.unsure.length)} that need a check or have no owner will change.` : 'No rows that need a check match this rule.'}
      </div>
      {preview.owned.length > 0 && (
        <label className="small">
          <input type="checkbox" checked={includeOwned} onChange={(e) => setIncludeOwned(e.target.checked)} /> Also change {rows(preview.owned.length)} that already have another owner
          {preview.ownedManual > 0 && ` (${preview.ownedManual} set by you)`}
        </label>
      )}
      <div className="btns">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => onDone(0)}>
          Not now
        </button>
        <button type="button" className="btn acc" disabled={busy || n === 0} onClick={apply}>
          Apply to {rows(n)}
        </button>
      </div>
    </div>
  )
}
