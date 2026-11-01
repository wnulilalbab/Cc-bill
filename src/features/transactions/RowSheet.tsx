// Row sheet (docs/intent/phase-1.md §6): owner, Check, label, the payments covering the row, fix amount/date/description,
// installment conversion on a REVERSAL CICILAN line, Keep waiting on a row the statement did not contain, and Delete.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { computeMoney, depositPaidOf } from '../../domain/amounts'
import { coverageOf, ownerBill, type OwnerBill } from '../../domain/bill'
import { deleteTransaction } from '../../domain/payments'
import { parseInstallmentReversal, type ConversionError, type ConversionResult } from '../../domain/installments'
import { canAcceptSign, sum } from '../../domain/money'
import { isMarketplace } from '../../domain/tagging/merchant'
import type { Ledger, Payment, Transaction, TxKind } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import {
  CONVERSION_ERRORS,
  convertRow,
  deleteRow,
  INSTALLMENT_AMOUNT,
  isConverted,
  isReviewed,
  keepWaitingOn,
  markReviewed,
  previewConversion,
  RowError,
  UNDO_CONVERSION,
  updateRow,
  acceptRebate,
  type RowPatch,
} from '../../data/transactions'
import { useData } from '../data/DataContext'
import { parseAmount, rp } from '../settings/format'
import { dayLabel, draftWarning, fmt, signedFor, statementName, statementsTurningDraft, TAG_SOURCE_LABEL, type RowView } from './view'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export interface RowSheetProps {
  row: RowView
  ledger: Ledger
  owners: readonly OwnerRecord[]
  onClose(): void
  /** The user tapped another owner: the tag sheet takes over (Always tag…, Keep / Unassign). */
  onPickOwner(ownerId: string): void
}

type Step = 'main' | 'delete' | 'convert' | 'sign'

const KIND_NAME: Record<TxKind, string> = { purchase: 'purchase', installment: 'installment', fee: 'fee', interest: 'interest', refund: 'refund', reversal: 'reversal' }
/** A row whose sign contradicts its kind can be fixed two ways: flip the sign, or keep it and pick the kind that fits. */
const KINDS_FOR_SIGN = (amount: number): TxKind[] => (amount < 0 ? ['refund', 'reversal'] : ['purchase', 'fee', 'interest'])
const today = () => new Date().toISOString().slice(0, 10)

const payLine = (p: Payment | undefined) => (!p ? 'Payment' : p.description ?? (p.source === 'manual' ? 'Recorded by you' : 'Bank payment'))

export function RowSheet({ row, ledger, owners, onClose, onPickOwner }: RowSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const t = row.tx
  const [step, setStep] = useState<Step>('main')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState(t.label ?? '')
  const [amount, setAmount] = useState(Math.abs(t.amount).toLocaleString('id-ID'))
  const [date, setDate] = useState(t.date)
  const [description, setDescription] = useState(t.description)
  const [conversion, setConversion] = useState<ConversionResult | { error: ConversionError } | null>(null)

  const statement = ledger.statements.find((s) => s.id === t.statementId)
  const nameOf = (id: string | null | undefined) => (id ? (owners.find((o) => o.id === id)?.name ?? 'Unknown') : 'Nobody')
  const coverage = coverageOf(ledger, t.id)
  const paymentById = (id: string) => ledger.payments.find((p) => p.id === id)
  const covering = ledger.payments.filter((p) => p.allocations.some((a) => a.txId === t.id && a.amount > 0))
  const coveredTotal = sum(covering.flatMap((p) => p.allocations.filter((a) => a.txId === t.id).map((a) => a.amount)))
  const convertible = t.kind === 'reversal' && !t.reverses && !!parseInstallmentReversal(t.description)
  const marketplace = (t.kind === 'purchase' || t.kind === 'refund') && isMarketplace(t.description)

  useEffect(() => {
    if (step !== 'convert') return
    let live = true
    previewConversion(db, t.id).then(
      (r) => live && setConversion(r),
      (e: unknown) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [db, step, t.id])

  async function run(work: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      toast(await work())
      onClose()
    } catch (e) {
      setError(e instanceof RowError ? e.message : `Could not save: ${String(e)}`)
      setBusy(false)
    }
  }

  // Only what the user changed is sent: a label-only save never touches the amount (or its sign).
  const amountChanged = amount !== Math.abs(t.amount).toLocaleString('id-ID')
  function saveDetails() {
    const patch: RowPatch = {}
    if (amountChanged) {
      const abs = parseAmount(amount)
      if (abs === null) return setError('Enter the amount in whole rupiah.')
      if (signedFor(t.kind, abs) !== t.amount) patch.amount = signedFor(t.kind, abs)
    }
    if (date !== t.date) patch.date = date
    if (description.trim().replace(/\s+/g, ' ') !== t.description) patch.description = description
    if (label.trim() !== (t.label ?? '')) patch.label = label
    const fixed = patch.amount !== undefined || patch.date !== undefined || patch.description !== undefined
    void run(async () => {
      if (!Object.keys(patch).length) return 'Nothing changed'
      await updateRow(db, t.id, patch)
      return fixed && statement?.kind === 'billed' ? `Saved. Totals check re-run for the ${statementName(statement)}.` : 'Saved'
    })
  }

  // A new date can change what the owner's deposit pays on this row (deposits pay charges dated on/after them).
  const depositAtDate =
    date !== t.date && ISO.test(date) ? depositPaidOf(computeMoney({ ...ledger, transactions: ledger.transactions.map((x) => (x.id === t.id ? { ...x, date } : x)) }), t.id) : coverage.fromDeposit
  const dateWarning =
    depositAtDate !== coverage.fromDeposit ? `With this date, ${nameOf(t.ownerId)}'s deposit pays ${rp(depositAtDate)} of this row instead of ${rp(coverage.fromDeposit)}.` : null

  if (step === 'delete') {
    const deposits = [...new Set(covering.filter((p) => p.depositOwnerId).map((p) => nameOf(p.depositOwnerId)))]
    const draft = draftWarning(statementsTurningDraft(ledger, { ...ledger, ...deleteTransaction(ledger, t.id) }))
    return (
      <Sheet title="Delete this transaction?" onClose={() => setStep('main')}>
        <div className="small">
          {t.description} · {rp(t.amount)}
        </div>
        {covering.length > 0 && (
          <div className="status draft">
            <div className="xs">
              {covering.length} payment{covering.length > 1 ? 's' : ''} cover{covering.length > 1 ? '' : 's'} this ({rp(coveredTotal)}). That money goes back to &quot;To assign&quot;
              {deposits.length ? `, or to ${deposits.join(' and ')}'s deposit for a payment kept as a deposit` : ''}.
            </div>
            {draft && <div className="xs warn-text">{draft}</div>}
          </div>
        )}
        {error && <div className="small err">{error}</div>}
        <div className="btns">
          <button type="button" className="btn ghost" onClick={() => setStep('main')}>
            Keep it
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => run(async () => (await deleteRow(db, t.id), 'Transaction deleted'))}>
            Delete
          </button>
        </div>
      </Sheet>
    )
  }

  if (step === 'sign') {
    const flipped = -t.amount
    // What the owner's bill for this statement becomes with each fix (domain ownerBill, live as of today).
    const billWith = (patch: Partial<Transaction>) =>
      ownerBill({ ...ledger, transactions: ledger.transactions.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }, t.ownerId, t.statementId, today())
    const now = billWith({})
    const options = KINDS_FOR_SIGN(t.amount)
    const line = (after: OwnerBill) => `${nameOf(t.ownerId)}'s ${statementName(statement).replace(' statement', '')} bill: ${rp(now.mustPay)} → ${rp(after.mustPay)}`
    return (
      <Sheet title="Fix the sign" onClose={() => setStep('main')}>
        <div className="small">
          {t.description}: {rp(t.amount)} is stored as a {KIND_NAME[t.kind]}, but a {KIND_NAME[t.kind]} should be {t.amount < 0 ? 'positive' : 'negative'}.
        </div>
        <div className="box tight small" aria-label="Flip the sign">
          <b>
            Keep as {KIND_NAME[t.kind]}, flip the sign: {rp(t.amount)} → {rp(flipped)}
          </b>
          <span className="xs muted">{line(billWith({ amount: flipped }))}</span>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => (await updateRow(db, t.id, { amount: flipped }), 'Sign fixed'))}>
            Keep as {KIND_NAME[t.kind]}, flip the sign
          </button>
        </div>
        {canAcceptSign(t.kind, t.amount) && (
          <div className="box tight small" aria-label="Accept as rebate">
            <b>
              It&apos;s a rebate: keep it as a {KIND_NAME[t.kind]} of {rp(t.amount)}
            </b>
            <span className="xs muted">{line(now)}. The statement no longer waits on this row.</span>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => (await acceptRebate(db, t.id), 'Accepted as a rebate'))}>
              Accept as rebate
            </button>
          </div>
        )}
        {options.map((k) => (
          <div key={k} className="box tight small" aria-label={`Change to ${k}`}>
            <b>
              It&apos;s a {KIND_NAME[k]}: change the kind, keep {rp(t.amount)}
            </b>
            <span className="xs muted">{line(billWith({ kind: k }))}</span>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => (await updateRow(db, t.id, { kind: k }), `Changed to ${KIND_NAME[k]}`))}>
              It&apos;s a {KIND_NAME[k]}: change the kind
            </button>
          </div>
        ))}
        {error && <div className="small err">{error}</div>}
        <button type="button" className="btn ghost" onClick={() => setStep('main')}>
          Cancel
        </button>
      </Sheet>
    )
  }

  if (step === 'convert') {
    return (
      <Sheet title="Convert to installment" onClose={() => setStep('main')}>
        {!conversion && !error && <div className="small muted">Looking for the original purchase…</div>}
        {conversion && 'error' in conversion && <div className="small err">{CONVERSION_ERRORS[conversion.error]}</div>}
        {conversion && !('error' in conversion) && <ConversionPreview result={conversion} ledger={ledger} nameOf={nameOf} />}
        {error && <div className="small err">{error}</div>}
        <div className="btns">
          <button type="button" className="btn ghost" onClick={() => setStep('main')}>
            Cancel
          </button>
          <button
            type="button"
            className="btn acc"
            disabled={busy || !conversion || 'error' in conversion}
            onClick={() =>
              run(async () => {
                const r = await convertRow(db, t.id)
                return r.conflicts.length ? 'Converted. A payment leftover went back to "Decide later".' : 'Converted to installment'
              })
            }
          >
            Convert
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={t.label ?? t.description} onClose={onClose}>
      <div className="row">
        <div>
          <div className="b num">{rp(t.amount)}</div>
          <div className="xs muted">
            {dayLabel(t.date)} · {statementName(statement)}
            {t.installment && ` · Installment ${t.installment.n}/${t.installment.of}`}
          </div>
        </div>
        {t.check && <span className="pill warn">● Check</span>}
      </div>

      {row.notOnStatement && (
        <div className="status bad">
          <h3>Not on the {row.notOnStatement} statement</h3>
          <div className="xs">This was in Unbilled from {dayLabel(t.date)} but the bank never billed it. It may have been cancelled or still pending.</div>
          <div className="chips">
            <button type="button" className="chip mini" disabled={busy} onClick={() => run(async () => (await keepWaitingOn(db, t.id), 'OK. It stays in Unbilled for the next statement.'))}>
              Keep waiting
            </button>
            <button type="button" className="chip mini" onClick={() => setStep('delete')}>
              Delete it
            </button>
          </div>
        </div>
      )}
      {t.kind === 'reversal' && t.reverses && (
        <div className="status final">
          <div className="xs">
            This reversal cancels {ledger.transactions.find((x) => x.id === t.reverses)?.description ?? 'the original purchase'}, which became an installment. Neither row is counted.
          </div>
        </div>
      )}
      {convertible && (
        <div className="status draft">
          <div className="xs">A reversal of an installment conversion. Converting cancels the original purchase and moves its payments to installment 1.</div>
          <button type="button" className="btn sm" onClick={() => setStep('convert')}>
            Convert to installment
          </button>
        </div>
      )}
      {t.cancelled && (
        <div className="status final">
          <div className="xs">Moved to installment. Not counted. Its payments moved to installment 1.</div>
        </div>
      )}

      <div className="box tight">
        <div className="xs muted">Line on the statement</div>
        <div className="small b">{t.description}</div>
        {marketplace && <div className="xs muted">Marketplace: the statement doesn&apos;t say who ordered. Check your order history by date and amount.</div>}
      </div>

      <div className="field">
        <span className="fl">
          Who pays{t.tagSource && !t.check ? ` · ${TAG_SOURCE_LABEL[t.tagSource]}` : ''}
        </span>
        <div className="chips" role="group" aria-label="Who pays">
          {owners
            .filter((o) => !o.archived || o.id === t.ownerId)
            .map((o) => (
              <button key={o.id} type="button" className="chip" aria-pressed={t.ownerId === o.id} disabled={o.archived} onClick={() => o.id !== t.ownerId && onPickOwner(o.id)}>
                {o.name}
              </button>
            ))}
        </div>
        {!isReviewed(t) && (
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => run(async () => (await markReviewed(db, [t.id]), t.check ? `Check cleared. ${nameOf(t.ownerId)} confirmed.` : `${nameOf(t.ownerId)} confirmed.`))}
          >
            {t.check ? `Clear Check: ${nameOf(t.ownerId)} is right` : 'Mark reviewed'}
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="rowLabel">Label</label>
        <input className="inp" id="rowLabel" value={label} placeholder="e.g. School books" onChange={(e) => setLabel(e.target.value)} />
      </div>
      <details>
        <summary>Fix amount, date or description</summary>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="btns">
            <div className="field">
              <label htmlFor="rowAmount">Amount</label>
              <input className="inp num" id="rowAmount" inputMode="numeric" value={amount} readOnly={t.kind === 'installment'} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rowDate">Date</label>
              <input className="inp" id="rowDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {t.kind === 'installment' && <div className="xs muted">{INSTALLMENT_AMOUNT}</div>}
          {dateWarning && <div className="xs warn-text">{dateWarning}</div>}
          {t.signAccepted && <div className="xs muted">Accepted as a rebate.</div>}
          {signedFor(t.kind, Math.abs(t.amount)) !== t.amount && !t.signAccepted && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => setStep('sign')}
            >
              Fix the sign: {fmt(signedFor(t.kind, Math.abs(t.amount)))}
            </button>
          )}
          <div className="field">
            <label htmlFor="rowDesc">Description</label>
            <input className="inp" id="rowDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="xs muted">Use this when the AI misread a line. The totals check runs again after you save.</div>
        </div>
      </details>

      {row.effective > 0 && (
        <div className="box tight" aria-label="Payments covering this">
          <div className="row">
            <span className="lbl">Payment</span>
            <StatusPill row={row} />
          </div>
          {coverage.payments.map((c) => (
            <div key={c.paymentId} className="row small">
              <Link to={`/v2/payments/${encodeURIComponent(c.paymentId)}`} aria-label={`Open payment of ${dayLabel(c.date)}`}>
                {dayLabel(c.date)} · {payLine(paymentById(c.paymentId))}
                {c.afterDue && <span className="pill warn"> after due</span>}
              </Link>
              <span className="num" style={{ color: 'var(--ok)' }}>
                − {fmt(c.amount)}
              </span>
            </div>
          ))}
          {coverage.fromDeposit > 0 && (
            <div className="row small">
              <span>From {nameOf(t.ownerId)}&apos;s deposit</span>
              <span className="num" style={{ color: 'var(--ok)' }}>
                − {fmt(coverage.fromDeposit)}
              </span>
            </div>
          )}
          {!coverage.payments.length && !coverage.fromDeposit && <div className="small muted">No payment covers this yet.</div>}
        </div>
      )}

      {error && <div className="small err">{error}</div>}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn acc" disabled={busy} onClick={saveDetails}>
          Save
        </button>
      </div>
      {isConverted(t) ? (
        <div className="xs muted" style={{ alignSelf: 'center' }}>
          Part of an installment conversion: can&apos;t be deleted. {UNDO_CONVERSION}
        </div>
      ) : (
        <button type="button" className="link" style={{ color: 'var(--bad)', alignSelf: 'center' }} onClick={() => setStep('delete')}>
          Delete transaction
        </button>
      )}
    </Sheet>
  )
}

function ConversionPreview({ result, ledger, nameOf }: { result: ConversionResult; ledger: Ledger; nameOf(id: string | null): string }) {
  const [original, , installment] = result.transactions
  const moved = sum(ledger.payments.flatMap((p) => p.allocations.filter((a) => a.txId === original.id).map((a) => a.amount)))
  const of = installment.installment?.of ?? result.plan.total
  return (
    <div className="box tight small" aria-label="Conversion preview">
      <div>
        <b>{original.description}</b> ({rp(original.amount)}, {dayLabel(original.date)}) is marked moved to installment and not counted. This reversal is not counted either.
      </div>
      <div>
        Installment 1/{of}: {rp(installment.amount)} a month for {of} months, for {nameOf(original.ownerId)}.
      </div>
      {moved > 0 && <div>{rp(moved)} of payments on the original move to installment 1/{of}; anything above it becomes {nameOf(original.ownerId)}&apos;s deposit.</div>}
      {result.conflicts.length > 0 && (
        <div className="warn-text">
          A payment&apos;s leftover is someone else&apos;s deposit, so it can&apos;t become {nameOf(original.ownerId)}&apos;s deposit. It goes back to &quot;Decide later&quot; and the bill stays Draft until you choose.
        </div>
      )}
    </div>
  )
}

export function StatusPill({ row }: { row: RowView }) {
  if (row.status === 'notCounted') return <span className="pill">Not counted</span>
  if (row.status === 'refund') return <span className="pill ok">Refund</span>
  if (row.status === 'paid') return <span className="pill ok">Paid</span>
  if (row.status === 'partial') return <span className="pill warn">{fmt(row.remaining)} left</span>
  return <span className="pill">Unpaid</span>
}
