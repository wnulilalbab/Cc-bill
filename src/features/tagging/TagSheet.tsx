// Tag one transaction: tap the owner, optionally "Always tag X as Y on <card>" (saves a rule, then offers to apply
// it to matching rows). Marketplace rows never offer a rule: the statement line doesn't say who ordered.
// On a row a payment covers, changing the owner first asks "Keep payment" / "Unassign" (X-05 / X-06).
// The Transactions screen opens this from a row.
import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { sum } from '../../domain/money'
import { isMarketplace, ruleKeyOf } from '../../domain/tagging/merchant'
import type { TagRule } from '../../domain/tagging/types'
import type { Ledger, Owner, Payment, Transaction } from '../../domain/types'
import { isCovered, paymentsAfterOwnerChange, type RowCover } from '../../data/coverage'
import { loadLedger } from '../../data/repo'
import { coverOfRow, RuleError, saveRule, setOwner, type PaymentChoice } from '../../data/rules'
import { useData } from '../data/DataContext'
import { rp } from '../settings/format'
import { draftWarning, statementsTurningDraft } from '../transactions/view'
import { ApplyRuleStep } from './ApplyRuleStep'

export interface TagSheetProps {
  tx: Transaction
  cardName: string
  /** The card's owners (archived ones are not offered). */
  owners: readonly Owner[]
  /** Owner picked already (the row sheet's chip); defaults to the row's owner. */
  initialOwnerId?: string | null
  onClose(): void
  /** Called after a save instead of onClose, when set. */
  onSaved?(): void
}

export function TagSheet({ tx, cardName, owners, initialOwnerId, onClose, onSaved }: TagSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [ownerId, setOwnerId] = useState<string | null>(initialOwnerId === undefined ? tx.ownerId : initialOwnerId)
  const [always, setAlways] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rule, setRule] = useState<TagRule | null>(null)
  const [ask, setAsk] = useState<{ cover: RowCover; ledger: Ledger } | null>(null)
  const [busy, setBusy] = useState(false)
  const marketplace = (tx.kind === 'purchase' || tx.kind === 'refund') && isMarketplace(tx.description)
  const key = ruleKeyOf(tx.description)
  const active = owners.filter((o) => !o.archived)
  const nameOf = (id: string | null) => owners.find((o) => o.id === id)?.name ?? 'Unknown'
  const changed = ownerId !== tx.ownerId
  const done = onSaved ?? onClose

  async function save(choice?: PaymentChoice) {
    setBusy(true)
    try {
      if (changed && !choice) {
        const cover = await coverOfRow(db, tx)
        if (isCovered(cover)) {
          setAsk({ cover, ledger: await loadLedger(db, tx.cardId) })
          setBusy(false)
          return
        }
      }
      await setOwner(db, tx.id, ownerId, { payments: choice })
      setAsk(null)
      if (always && ownerId && !marketplace) {
        setRule(await saveRule(db, { cardId: tx.cardId, match: 'contains', pattern: key, ownerId }))
        setBusy(false)
        return
      }
      const saved = choice === 'unassign' ? 'Saved. The payment was unassigned.' : choice === 'keep' ? 'Saved. The payment stays on it.' : 'Saved'
      toast(marketplace && changed ? 'Saved. Marketplace rows always ask for a check, so no rule is offered.' : saved)
      done()
    } catch (e) {
      setAsk(null)
      setError(e instanceof RuleError ? e.message : `Could not save: ${String(e)}`)
      setBusy(false)
    }
  }

  if (ask) {
    const { cover, ledger } = ask
    const explicit = sum(cover.explicit.flatMap((p) => p.allocations.filter((a) => a.txId === tx.id).map((a) => a.amount)))
    const fromDeposit = sum(cover.deposit.map((d) => d.amount))
    const depositPayments = cover.deposit.map((d) => ledger.payments.find((p) => p.id === d.paymentId)!)
    const payerIds = new Set([...cover.explicit, ...depositPayments].flatMap((p) => [...(p.forOwnerIds ?? []), ...(p.depositOwnerId ? [p.depositOwnerId] : [])]))
    payerIds.delete(ownerId ?? '')
    const payer = [...payerIds].map(nameOf).join(', ') || (tx.ownerId && tx.ownerId !== ownerId ? nameOf(tx.ownerId) : 'another person')
    const to = ownerId === null ? 'nobody' : nameOf(ownerId)
    const depositNames = (list: readonly Payment[]) => [...new Set(list.filter((p) => p.depositOwnerId).map((p) => nameOf(p.depositOwnerId!)))].join(' and ')
    const backTo = depositNames(cover.explicit)
    const usedFrom = depositNames(depositPayments)
    const after: Ledger = {
      ...ledger,
      transactions: ledger.transactions.map((t) => (t.id === tx.id ? { ...t, ownerId } : t)),
      payments: paymentsAfterOwnerChange(ledger, tx.id, 'unassign').payments,
    }
    const draft = draftWarning(statementsTurningDraft(ledger, after))
    return (
      <Sheet title="This charge already has a payment" onClose={() => setAsk(null)}>
        <div className="small">
          {rp(explicit + fromDeposit)} from {payer}&apos;s {fromDeposit && !explicit ? 'deposit' : 'payment'} covers it. You&apos;re moving it to {to}.
        </div>
        <div className="box tight small">
          <b>Keep the payment on it</b>
          <span className="muted xs">
            {payer}&apos;s money keeps paying this charge, now owned by {to}.
            {fromDeposit > 0 && ` The ${rp(fromDeposit)} from ${usedFrom}'s deposit is assigned to it, so it stays paid.`}
          </span>
        </div>
        <div className="box tight small">
          <b>Unassign the payment</b>
          <span className="muted xs">
            The charge becomes unpaid for {to}.
            {explicit > 0 && ` The payment goes back to ${backTo ? `${backTo}'s deposit` : '"To assign"'}.`}
            {fromDeposit > 0 && ` ${usedFrom}'s deposit stops paying it (${rp(fromDeposit)} stays in the deposit).`}
          </span>
          {draft && <span className="xs warn-text">{draft}</span>}
        </div>
        <div className="btns">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => save('keep')}>
            Keep payment
          </button>
          <button type="button" className="btn acc" disabled={busy} onClick={() => save('unassign')}>
            Unassign
          </button>
        </div>
      </Sheet>
    )
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
            done()
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
            <button type="button" className="btn acc" disabled={busy} onClick={() => save()}>
              Save
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
