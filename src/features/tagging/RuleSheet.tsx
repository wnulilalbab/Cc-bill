// Add or edit one tagging rule of a card, then offer to apply it to existing rows.
import { useState } from 'react'
import { Picker } from '../../components/Picker'
import { Sheet } from '../../components/Sheet'
import { ruleProblem } from '../../domain/tagging/rules'
import type { RuleMatch, TagRule } from '../../domain/tagging/types'
import type { Owner } from '../../domain/types'
import { deleteRule, RuleError, saveRule } from '../../data/rules'
import { useData } from '../data/DataContext'
import { ApplyRuleStep } from './ApplyRuleStep'

export const MATCH_OPTIONS: { value: RuleMatch; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'startsWith', label: 'Starts with' },
]

export const ownerOptions = (owners: readonly Owner[]) => owners.filter((o) => !o.archived).map((o) => ({ value: o.id, label: o.name }))

export interface RuleSheetProps {
  cardId: string
  /** The card's owners (archived ones are not offered). */
  owners: readonly Owner[]
  /** Unset when adding. */
  rule?: TagRule
  onClose(message?: string): void
}

export function RuleSheet({ cardId, owners, rule, onClose }: RuleSheetProps) {
  const { db } = useData()
  const active = ownerOptions(owners)
  const [match, setMatch] = useState<RuleMatch>(rule?.match ?? 'contains')
  const [pattern, setPattern] = useState(rule?.pattern ?? '')
  const [ownerId, setOwnerId] = useState(rule?.ownerId ?? active[0]?.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<TagRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    const draft = { id: rule?.id, cardId, match, pattern, ownerId }
    const problem = ruleProblem(draft, owners)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      setSaved(await saveRule(db, draft))
    } catch (e) {
      setError(e instanceof RuleError ? e.message : `Could not save the rule: ${String(e)}`)
    }
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteRule(db, rule!.id)
      onClose('Rule deleted')
    } catch (e) {
      setError(`Could not delete the rule: ${String(e)}`)
      setBusy(false)
    }
  }

  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name ?? 'Unknown'
  return (
    <Sheet title={rule ? 'Edit rule' : 'Add rule'} onClose={() => onClose()}>
      {saved ? (
        <ApplyRuleStep rule={saved} ownerName={nameOf(saved.ownerId)} onDone={(n) => onClose(n ? `Rule saved and applied to ${n} row${n === 1 ? '' : 's'}` : 'Rule saved')} />
      ) : (
        <>
          <div className="field">
            <span className="fl">Statement line</span>
            <Picker title="Match" field value={match} options={MATCH_OPTIONS} onChange={(v) => setMatch(v as RuleMatch)} />
          </div>
          <div className="field">
            <label htmlFor="rulePattern">Text</label>
            <input className="inp" id="rulePattern" placeholder="e.g. GRAB* or NETFLIX" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </div>
          <div className="field">
            <span className="fl">Owner</span>
            <Picker title="Owner" field value={ownerId} options={active} onChange={setOwnerId} />
          </div>
          {error && <div className="small err">{error}</div>}
          <div className="btns">
            <button type="button" className="btn ghost" onClick={() => onClose()}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={busy} onClick={save}>
              Save rule
            </button>
          </div>
          {rule &&
            (confirmDelete ? (
              <div className="status draft">
                <div className="small">Delete this rule? Rows it already tagged keep their owner.</div>
                <div className="btns">
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                  <button type="button" className="btn danger" disabled={busy} onClick={remove}>
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link" style={{ color: 'var(--bad)', alignSelf: 'center' }} onClick={() => setConfirmDelete(true)}>
                Delete rule
              </button>
            ))}
        </>
      )}
    </Sheet>
  )
}
