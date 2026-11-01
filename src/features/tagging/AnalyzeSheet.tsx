// "Analyze my labels": suggested rules from how past rows of this card were tagged. Each one shows its evidence
// ("N of M past rows agree") and can be accepted, edited, or dismissed with a comment for the next analysis.
import { useEffect, useRef, useState } from 'react'
import { Picker } from '../../components/Picker'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { analyzeLabels, AnalyzeError } from '../../ai/tagging/analyze'
import { describeMatch, evidenceText, ruleEvidence, type VettedProposal } from '../../domain/tagging/rules'
import type { RuleMatch, TagRule } from '../../domain/tagging/types'
import type { Owner } from '../../domain/types'
import { dismissSuggestion, labelHistory, listDismissals, listRules, RuleError, saveRule } from '../../data/rules'
import { useData } from '../data/DataContext'
import { readAiSettings } from '../settings/aiSettings'
import { ApplyRuleStep } from './ApplyRuleStep'
import { MATCH_OPTIONS, ownerOptions } from './RuleSheet'

export interface AnalyzeSheetProps {
  cardId: string
  cardName: string
  owners: readonly Owner[]
  onClose(): void
}

type Item = VettedProposal & { key: string; comment: string; editing: boolean }

export function AnalyzeSheet({ cardId, cardName, owners, onClose }: AnalyzeSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState<TagRule | null>(null)
  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name ?? 'Unknown'
  // One analysis per opening: later changes to the owner list (e.g. a rule saved here) don't re-run it.
  const ownersAtOpen = useRef(owners)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { apiKey, model } = readAiSettings()
      const [history, rules, dismissed] = await Promise.all([labelHistory(db, cardId), listRules(db, cardId), listDismissals(db, cardId)])
      const out = await analyzeLabels({ cardId, owners: ownersAtOpen.current, history, rules, dismissed }, { apiKey, model, db })
      if (live) setItems(out.map((p, i) => ({ ...p, key: `${i}`, comment: '', editing: false })))
    })().catch((e: unknown) => {
      if (live) setError(e instanceof AnalyzeError ? e.message : `Could not analyze the labels: ${String(e)}`)
    })
    return () => {
      live = false
    }
  }, [db, cardId])

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs!.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const drop = (key: string) => setItems((xs) => xs!.filter((x) => x.key !== key))

  async function accept(it: Item) {
    try {
      const rule = await saveRule(db, { cardId, match: it.match, pattern: it.pattern, ownerId: it.ownerId }, { origin: 'analyze' })
      drop(it.key)
      toast('Rule added')
      setApplying(rule)
    } catch (e) {
      setError(e instanceof RuleError ? e.message : `Could not add the rule: ${String(e)}`)
    }
  }

  async function dismiss(it: Item) {
    await dismissSuggestion(db, cardId, { match: it.match, pattern: it.pattern, ownerId: it.ownerId, comment: it.comment, at: new Date().toISOString() })
    drop(it.key)
  }

  /** Applies an edit now; the evidence is recounted for it and shown if the suggestion still reads the same. */
  function edited(it: Item, p: Partial<Item>) {
    const next = { ...it, ...p }
    patch(it.key, p)
    void labelHistory(db, cardId).then((history) => {
      const ev = ruleEvidence({ ...next, cardId }, history)
      setItems((xs) => xs!.map((x) => (x.key === it.key && x.match === next.match && x.pattern === next.pattern && x.ownerId === next.ownerId ? { ...x, ...ev } : x)))
    })
  }

  return (
    <Sheet title={`Suggested rules · ${cardName}`} onClose={onClose}>
      <div className="xs muted">From how you tagged past rows on this card.</div>
      {applying ? (
        <ApplyRuleStep
          rule={applying}
          ownerName={nameOf(applying.ownerId)}
          onDone={(n) => {
            if (n) toast(`Applied to ${n} row${n === 1 ? '' : 's'}`)
            setApplying(null)
          }}
        />
      ) : error ? (
        <div className="small err">{error}</div>
      ) : !items ? (
        <div className="small muted">Analyzing your labels…</div>
      ) : !items.length ? (
        <div className="box empty small">No more suggestions.</div>
      ) : (
        items.map((it) => (
          <div key={it.key} className="box tight" aria-label={`Suggestion ${describeMatch(it)}`}>
            {it.editing ? (
              <>
                <Picker title="Match" field value={it.match} options={MATCH_OPTIONS} onChange={(v) => edited(it, { match: v as RuleMatch })} />
                <input className="inp" aria-label="Text" value={it.pattern} onChange={(e) => edited(it, { pattern: e.target.value })} />
                <Picker title="Owner" field value={it.ownerId} options={ownerOptions(owners)} onChange={(v) => edited(it, { ownerId: v })} />
              </>
            ) : (
              <div className="small">
                {describeMatch(it)} → <b>{nameOf(it.ownerId)}</b>
              </div>
            )}
            <div className="xs muted">{evidenceText(it)}</div>
            {it.reason && <div className="xs muted">{it.reason}</div>}
            <input className="inp xs" placeholder="Comment for the next analysis (optional)" aria-label="Comment" value={it.comment} onChange={(e) => patch(it.key, { comment: e.target.value })} />
            <div className="btns">
              <button type="button" className="btn sm ghost" onClick={() => dismiss(it)}>
                Dismiss
              </button>
              {!it.editing && (
                <button type="button" className="btn sm ghost" onClick={() => patch(it.key, { editing: true })}>
                  Edit
                </button>
              )}
              <button type="button" className="btn sm acc" onClick={() => accept(it)}>
                Accept
              </button>
            </div>
          </div>
        ))
      )}
      <button type="button" className="btn ghost" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}
