// Settings → Tagging rules (per card) + "Analyze my labels".
import { useState } from 'react'
import { Picker } from '../../components/Picker'
import { useToast } from '../../components/Toast'
import { describeMatch } from '../../domain/tagging/rules'
import type { TagRule } from '../../domain/tagging/types'
import { listRules } from '../../data/rules'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { PATHS } from '../shell/paths'
import { TopBar } from '../shell/TopBar'
import { AnalyzeSheet } from './AnalyzeSheet'
import { RuleSheet } from './RuleSheet'

type Open = { kind: 'rule'; rule?: TagRule } | { kind: 'analyze' } | null

export function RulesPage() {
  const { db } = useData()
  const toast = useToast()
  const { cards, selected, selectCard } = useAppearance()
  const [open, setOpen] = useState<Open>(null)
  const cardId = selected?.card.id
  const rules = useDbQuery(() => (cardId ? listRules(db, cardId) : Promise.resolve([])), [db, cardId])
  const owners = selected?.owners ?? []
  const nameOf = (id: string) => {
    const o = owners.find((x) => x.id === id)
    return o ? `${o.name}${o.archived ? ' (archived)' : ''}` : 'Unknown owner'
  }
  const close = (message?: string) => {
    setOpen(null)
    if (message) toast(message)
  }

  return (
    <div className="screen">
      <TopBar title="Tagging rules" backTo={PATHS.settings} gear={false} />

      {cards === undefined ? (
        <div className="small muted">Loading…</div>
      ) : !selected ? (
        <div className="box empty small">Add a card in Settings first. Rules belong to one card.</div>
      ) : (
        <>
          {cards.length > 1 && (
            <div className="field">
              <span className="fl">Card</span>
              <Picker title="Card" field value={selected.card.id} options={cards.map((c) => ({ value: c.card.id, label: c.card.name }))} onChange={selectCard} />
            </div>
          )}
          <div className="lbl">Tagging rules · {selected.card.name}</div>
          <div className="box tight">
            {rules === undefined ? (
              <div className="small muted">Loading…</div>
            ) : rules.length === 0 ? (
              <div className="small muted">No rules yet.</div>
            ) : (
              rules.map((r) => (
                <div key={r.id} className="row small">
                  <span>
                    {describeMatch(r)} → <b>{nameOf(r.ownerId)}</b>
                  </span>
                  <button type="button" className="link" aria-label={`Edit rule ${describeMatch(r)}`} onClick={() => setOpen({ kind: 'rule', rule: r })}>
                    Edit
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="note">Rules apply on {selected.card.name} only. Marketplace rows (Shopee, Tokopedia…) always ask for a check, even with a rule.</div>
          <button type="button" className="btn ghost" onClick={() => setOpen({ kind: 'rule' })}>
            + Add rule
          </button>
          <button type="button" className="btn ghost" onClick={() => setOpen({ kind: 'analyze' })}>
            Analyze my labels
          </button>

          {open?.kind === 'rule' && <RuleSheet cardId={selected.card.id} owners={owners} rule={open.rule} onClose={close} />}
          {open?.kind === 'analyze' && <AnalyzeSheet cardId={selected.card.id} cardName={selected.card.name} owners={owners} onClose={() => close()} />}
        </>
      )}
    </div>
  )
}
