// Tag one transaction: tap the owner, optionally "Always tag X as Y on <card>" (saves a rule, then offers to apply
// it to matching rows). Marketplace rows never offer a rule: the statement line doesn't say who ordered.
// The Transactions screen (Slice 8) opens this from a row.
import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { isMarketplace, ruleKeyOf } from '../../domain/tagging/merchant'
import type { TagRule } from '../../domain/tagging/types'
import type { Owner, Transaction } from '../../domain/types'
import { RuleError, saveRule, setOwner } from '../../data/rules'
import { useData } from '../data/DataContext'
import { ApplyRuleStep } from './ApplyRuleStep'

export interface TagSheetProps {
  tx: Transaction
  cardName: string
  /** The card's owners (archived ones are not offered). */
  owners: readonly Owner[]
  onClose(): void
}

export function TagSheet({ tx, cardName, owners, onClose }: TagSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [ownerId, setOwnerId] = useState<string | null>(tx.ownerId)
  const [always, setAlways] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rule, setRule] = useState<TagRule | null>(null)
  const [busy, setBusy] = useState(false)
  const marketplace = (tx.kind === 'purchase' || tx.kind === 'refund') && isMarketplace(tx.description)
  const key = ruleKeyOf(tx.description)
  const active = owners.filter((o) => !o.archived)
  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name ?? 'Unknown'
  const changed = ownerId !== tx.ownerId

  async function save() {
    setBusy(true)
    try {
      await setOwner(db, tx.id, ownerId)
      if (always && ownerId && !marketplace) {
        setRule(await saveRule(db, { cardId: tx.cardId, match: 'contains', pattern: key, ownerId }))
        setBusy(false)
        return
      }
      toast(marketplace && changed ? 'Saved. Marketplace rows always ask for a check, so no rule is offered.' : 'Saved')
      onClose()
    } catch (e) {
      setError(e instanceof RuleError ? e.message : `Could not save: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Sheet title={tx.description} onClose={onClose}>
      {rule ? (
        <ApplyRuleStep
          rule={rule}
          ownerName={nameOf(rule.ownerId)}
          except={tx.id}
          onDone={(n) => {
            toast(n ? `Rule saved and applied to ${n} more row${n === 1 ? '' : 's'}` : 'Rule saved')
            onClose()
          }}
        />
      ) : (
        <>
          <div className="row">
            <span className="b num">Rp {tx.amount.toLocaleString('id-ID')}</span>
            {tx.check && <span className="pill warn">● Check</span>}
          </div>
          <div className="box tight">
            <div className="xs muted">Line on the statement</div>
            <div className="small b">{tx.description}</div>
            {marketplace && <div className="xs muted">Marketplace: the statement doesn&apos;t say who ordered. Check your order history by date and amount.</div>}
          </div>
          <div className="field">
            <span className="fl">Who pays</span>
            <div className="chips" role="group" aria-label="Who pays">
              {active.map((o) => (
                <button key={o.id} type="button" className="chip" aria-pressed={ownerId === o.id} onClick={() => setOwnerId(o.id)}>
                  {o.name}
                </button>
              ))}
            </div>
          </div>
          {ownerId && !marketplace && (
            <label className="small">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always tag &quot;{key}&quot; as {nameOf(ownerId)} on {cardName}
            </label>
          )}
          {error && <div className="small err">{error}</div>}
          <div className="btns">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
