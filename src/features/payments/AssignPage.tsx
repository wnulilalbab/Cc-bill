// The full-screen assign page (docs/intent/phase-1.md §7, prototype "Assign payment" / "Record a payment"): sticky
// header (back, source, live Left to assign), who it's for, the charges it paid (tap, type, Pay full, Fill oldest
// first, Pay all in this statement), and a sticky footer (assigned total, deposit or Decide later, Save).
// Every rule comes from src/domain/allocate.ts; the payment actions (Keep waiting, Paid to another card, Delete) from
// src/domain/payments.ts through src/data/payments.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { BackIcon } from '../../components/icons'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import {
  candidates,
  checkDraft,
  draftFromPayment,
  fillOldestFirst,
  payAllInStatement,
  payFull,
  selectOwner,
  setAllocation,
  tapCharge,
  type AssignDraft,
  type CandidateGroup,
} from '../../domain/allocate'
import { bankStatus, canEditAmountAndDate } from '../../domain/payments'
import type { Ledger, Payment } from '../../domain/types'
import type { CardWithOwners } from '../../data/cards'
import { keepPaymentWaiting, movePayment, newPaymentId, removePayment, saveAssign } from '../../data/payments'
import { loadLedger } from '../../data/repo'
import { Picker } from '../../components/Picker'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { rp } from '../settings/format'
import { dayLabel, draftWarning, fmt, statementName } from '../transactions/view'
import { ownerLook, Pill } from './PaymentsPage'
import { bankLabel, deleteEffect, typedRupiah, unbilledNotOnStatement } from './view'

const LIST = '/v2/payments'
const today = () => new Date().toISOString().slice(0, 10)
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Loads the payment (or, for a new one, the selected card) and its card's ledger, then shows the form. */
export function AssignPage() {
  const { paymentId } = useParams()
  const isNew = !paymentId || paymentId === 'new'
  const { db } = useData()
  const { cards, selected } = useAppearance()
  const [newCardId, setNewCardId] = useState<string | undefined>(undefined)
  const data = useDbQuery(async () => {
    const payment = isNew ? undefined : await db.payments.get(paymentId!)
    const cardId = payment?.cardId ?? newCardId ?? selected?.card.id
    return { payment, cardId, ledger: cardId ? await loadLedger(db, cardId) : undefined, key: `${paymentId}|${newCardId ?? selected?.card.id}` }
  }, [db, paymentId, newCardId, selected?.card.id])
  const navigate = useNavigate()

  const fresh = data && data.key === `${paymentId}|${newCardId ?? selected?.card.id}`
  if (!cards || !fresh) return <div className="screen small muted">Loading…</div>
  const card = cards.find((c) => c.card.id === data.cardId)
  if ((!isNew && !data.payment) || !card || !data.ledger) {
    return (
      <div className="screen">
        <div className="box empty">{isNew ? 'Add a card in Settings first.' : 'This payment no longer exists.'}</div>
        <button type="button" className="btn ghost" onClick={() => navigate(LIST)}>
          Back to Payments
        </button>
      </div>
    )
  }
  // A bank line merged into a hand-recorded payment is assigned through that payment (counted once).
  const hand = data.payment && data.payment.source !== 'manual' ? data.ledger.payments.find((p) => p.source === 'manual' && p.linkedStatementLine === data.payment!.id) : undefined
  if (hand) return <Navigate to={`${LIST}/${encodeURIComponent(hand.id)}`} replace />
  return (
    <AssignForm
      key={data.payment?.id ?? `new-${card.card.id}`}
      payment={data.payment}
      card={card}
      cards={cards}
      ledger={data.ledger}
      onCardChange={isNew ? setNewCardId : undefined}
    />
  )
}

type Step = null | 'delete' | 'move' | 'keepBoth'

interface FormProps {
  payment: Payment | undefined
  card: CardWithOwners
  cards: CardWithOwners[]
  ledger: Ledger
  /** New payments only: pick the card. */
  onCardChange?: (cardId: string) => void
}

function AssignForm({ payment, card, cards, ledger, onCardChange }: FormProps) {
  const { db } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const { selectCard } = useAppearance()
  const owners = card.owners
  const editable = !payment || canEditAmountAndDate(payment)
  const [draft, setDraft] = useState<AssignDraft>(() =>
    payment
      ? draftFromPayment(payment, ledger.transactions)
      : { cardId: card.card.id, date: today(), amount: 0, ownerIds: [], multi: false, allocations: {} },
  )
  const [amountText, setAmountText] = useState(payment ? payment.amount.toLocaleString('id-ID') : '')
  const [note, setNote] = useState(payment?.description ?? '')
  const [deposit, setDeposit] = useState<string | null>(payment?.depositOwnerId ?? null)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  const [step, setStep] = useState<Step>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One write at a time, even before React re-renders the disabled button; a new payment keeps one id across retries.
  const inFlight = useRef(false)
  const [newId] = useState(newPaymentId)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  // Ticks on charges that no longer exist (deleted elsewhere) are dropped, so the domain never sees an unknown row.
  const live = useMemo(() => {
    const allocations = Object.fromEntries(Object.entries(draft.allocations).filter(([id]) => ledger.transactions.some((t) => t.id === id)))
    return { ...draft, allocations }
  }, [draft, ledger])
  const check = checkDraft(ledger, live)
  const cand = live.ownerIds.length ? candidates(ledger, live) : undefined
  const nameOf = (id: string) => ownerLook(owners, id).name
  const txOf = (id: string) => ledger.transactions.find((t) => t.id === id)!
  const titleOf = (id: string) => txOf(id).label ?? txOf(id).description
  const status = payment ? bankStatus(ledger, payment) : undefined
  const latestMissing = payment && unbilledNotOnStatement(ledger, payment)
  const chips = owners.filter((o) => !o.archived || live.ownerIds.includes(o.id))
  const otherCards = cards.filter((c) => c.card.id !== card.card.id)
  const deletable = !!payment && payment.source !== 'statement'

  const leave = () => navigate(LIST)
  const run = async (what: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await what()
    } catch (e) {
      setError(errText(e))
      setStep(null)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const setAmount = (text: string) => {
    setAmountText(text)
    setDraft((d) => ({ ...d, amount: typedRupiah(text) }))
  }
  const tap = (txId: string) => {
    if (live.amount <= 0) return toast('Enter the amount first.')
    const r = tapCharge(ledger, live, txId)
    setDraft(r.draft)
    if (r.outcome === 'partial') toast(`Only ${fmt(r.amount)} was left in this payment, so this charge is partly paid.`)
    else if (r.outcome === 'paymentFull') toast('This payment is already fully assigned. Untick something first.')
    else if (r.outcome === 'nothingOpen') toast('Nothing is open on this charge.')
  }
  const full = (txId: string) => {
    const r = payFull(ledger, live, txId)
    setDraft(r.draft)
    if (!r.full) toast('Not enough left in this payment to pay it in full.')
  }
  const oldest = () => {
    const r = fillOldestFirst(ledger, live)
    setDraft(r.draft)
    if (r.filled < r.of) toast(`The payment ran out after ${r.filled} of ${r.of} charges.`)
  }
  const allIn = (g: CandidateGroup) => {
    const r = payAllInStatement(ledger, live, g.statementId)
    setDraft(r.draft)
    if (r.ranOut) toast(`The payment ran out after ${r.filled} of ${r.of} charges.`)
  }
  const waitMore = () =>
    run(async () => {
      await keepPaymentWaiting(db, payment!.id)
      toast("OK. It's checked again when the next statement arrives.")
      leave()
    })
  const save = () =>
    run(async () => {
      const r = await saveAssign(db, live, check.left > 0 ? deposit : null, { ...(editable && { description: note }), newId })
      const left = check.left
      if (r.linkedTo) toast(`Saved and matched to the bank line of ${dayLabel(r.linkedTo.date)}. It's counted once.`)
      else if (left > 0 && !deposit) toast(`Saved. ${fmt(left)} is still unassigned, so the bill stays Draft.`)
      else toast('Payment saved')
      leave()
    })

  const sourceText = !payment
    ? 'Recorded by hand'
    : payment.source === 'manual'
      ? 'Recorded by hand'
      : statementName(ledger.statements.find((s) => s.id === payment.statementId))
  const leftColor = check.left < 0 ? 'var(--bad)' : check.left > 0 ? 'var(--warn)' : 'var(--ok)'

  return (
    <section className="ccb-full" aria-label={payment ? 'Assign payment' : 'Record a payment'}>
      <div className="screen pay-page">
        <div className="phead">
          <button type="button" className="iconbtn" aria-label="Back" onClick={leave}>
            <BackIcon />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="xs muted">{sourceText}</div>
            <h1 ref={heading} tabIndex={-1}>
              {payment ? 'Assign payment' : 'Record a payment'}
            </h1>
          </div>
          <div style={{ textAlign: 'right' }} aria-live="polite">
            <div className="xs muted">Left to assign</div>
            <b className="num" aria-label="Left to assign" style={{ color: leftColor }}>
              {fmt(check.left)}
            </b>
          </div>
        </div>

        {onCardChange && cards.length > 1 && (
          <Picker
            title="Card"
            value={card.card.id}
            options={cards.map((c) => ({ value: c.card.id, label: c.card.name, sub: c.card.bank }))}
            onChange={onCardChange}
            field
          />
        )}

        {editable ? (
          <>
            <div className="btns">
              <div className="field">
                <label htmlFor="payAmt">Amount</label>
                <input className="inp num" id="payAmt" inputMode="numeric" value={amountText} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="payDate">Date you transferred</label>
                <input className="inp" id="payDate" type="date" value={live.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="payNote">Note (optional)</label>
              <input className="inp" id="payNote" value={note} placeholder="e.g. Transfer from Sari" onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="xs muted">Recorded by hand. When the statement prints the same amount within 5 days, the two are matched and counted once.</div>
          </>
        ) : (
          <>
            <div className="btns">
              <div className="field">
                <span className="fl">Amount</span>
                <div className="inp num b" aria-label="Amount">
                  {fmt(payment!.amount)}
                </div>
              </div>
              <div className="field">
                <span className="fl">Date</span>
                <div className="inp" aria-label="Date">
                  {dayLabel(payment!.date)}
                </div>
              </div>
            </div>
            <div className="xs muted">
              {payment!.source === 'manual'
                ? `Matched to the bank's payment line, so the amount and date can't be changed.`
                : `From the bank${payment!.description ? `: ${payment!.description}` : ''}. Amount and date can't be changed.`}
            </div>
          </>
        )}

        {payment && payment.source === 'manual' && status && (
          <section className={`status ${status.kind === 'missing' || status.kind === 'possibleDuplicate' ? 'bad' : status.kind === 'linked' ? 'final' : 'draft'}`} aria-label="At the bank">
            <div className="row">
              <b className="small">At the bank</b>
              <Pill label={bankLabel(ledger, payment)} />
            </div>
            {status.kind === 'missing' && (
              <>
                <div className="xs">The {statementName(ledger.statements.find((s) => s.id === status.statementId))} doesn&apos;t show it. What happened?</div>
                <div className="chips">
                  <button type="button" className="chip mini" disabled={busy} onClick={waitMore}>
                    Keep waiting
                  </button>
                  {otherCards.length > 0 && (
                    <button type="button" className="chip mini" onClick={() => setStep('move')}>
                      Paid to another card
                    </button>
                  )}
                  <button type="button" className="chip mini" onClick={() => setStep('delete')}>
                    Transfer failed, delete
                  </button>
                </div>
              </>
            )}
            {status.kind === 'possibleDuplicate' && (() => {
              const line = ledger.payments.find((x) => x.id === status.lineId)!
              return (
                <>
                  <div className="xs">
                    The bank shows {rp(line.amount)} on {dayLabel(line.date)}, already assigned. If that is this transfer, the money is counted twice and the bills come out too low.
                  </div>
                  <div className="chips">
                    <button type="button" className="chip mini" onClick={() => setStep('delete')}>
                      Same transfer, delete this one
                    </button>
                    <button type="button" className="chip mini" onClick={() => setStep('keepBoth')}>
                      Different transfers, keep both
                    </button>
                    {otherCards.length > 0 && (
                      <button type="button" className="chip mini" onClick={() => setStep('move')}>
                        Paid to another card
                      </button>
                    )}
                  </div>
                </>
              )
            })()}
          </section>
        )}
        {latestMissing && (
          <section className="status bad" aria-label="At the bank">
            <b className="small">Not on the {statementName(latestMissing)}</b>
            <div className="xs">This payment line was in Unbilled from {dayLabel(payment!.date)}, but the statement doesn&apos;t show it.</div>
            <div className="chips">
              <button type="button" className="chip mini" disabled={busy} onClick={waitMore}>
                Keep waiting
              </button>
              <button type="button" className="chip mini" onClick={() => setStep('delete')}>
                Delete it
              </button>
            </div>
          </section>
        )}

        <div className="field">
          <span className="fl">{live.multi ? 'Who is this payment for? (several people)' : 'Who is this payment for?'}</span>
          <div className="chips" role="group" aria-label="Who is this payment for?">
            {chips.map((o) => {
              const look = ownerLook(owners, o.id)
              return (
                <button key={o.id} type="button" className="chip" aria-pressed={live.ownerIds.includes(o.id)} style={{ ['--oc' as string]: look.color }} onClick={() => setDraft(selectOwner(ledger, live, o.id))}>
                  <i />
                  {o.name}
                </button>
              )
            })}
          </div>
          {!live.multi && (
            <button type="button" className="link xs" style={{ alignSelf: 'flex-start' }} onClick={() => setDraft({ ...live, multi: true })}>
              It was for more than one person
            </button>
          )}
        </div>

        {cand ? (
          <>
            <div className="row">
              <span className="lbl">Tap the charges it paid</span>
              <span className="chips">
                <button type="button" className="chip mini" onClick={oldest}>
                  Fill oldest first
                </button>
                <button type="button" className="chip mini" onClick={() => setDraft({ ...live, allocations: {} })}>
                  Clear
                </button>
              </span>
            </div>
            <div className="xs muted" aria-label="Hidden charges">
              Oldest statement first. Not shown: {cand.hiddenLater} charge{cand.hiddenLater === 1 ? '' : 's'} made after {live.date ? dayLabel(live.date) : 'the payment date'}, {cand.hiddenPaid} already fully paid by other payments.
            </div>
            {!cand.groups.length && (
              <div className="small muted">
                Nothing unpaid for {live.ownerIds.map(nameOf).join(', ')} up to the payment date.
              </div>
            )}
            {cand.groups.map((g, gi) => {
              const ticked = g.items.filter((i) => i.txId in live.allocations).length
              const firstOpen = gi === 0
              const open = groupOpen[g.statementId] ?? (ticked > 0 || firstOpen)
              const name = statementName(ledger.statements.find((s) => s.id === g.statementId))
              return (
                <section key={g.statementId} aria-label={name}>
                  <button type="button" className="grp" aria-expanded={open} onClick={() => setGroupOpen((m) => ({ ...m, [g.statementId]: !open }))}>
                    <span>
                      <span className="t">{name}</span>
                      <div className="xs muted">
                        {g.items.length} open · {fmt(g.openTotal)}
                        {ticked > 0 && ` · ${ticked} ticked`}
                      </div>
                    </span>
                    <span className="chev" />
                  </button>
                  {open && (
                    <div>
                      <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 6 }}>
                        <button type="button" className="chip mini" onClick={() => allIn(g)}>
                          Pay all in this statement
                        </button>
                      </div>
                      {g.items.map((item) => {
                        const on = item.txId in live.allocations
                        const value = live.allocations[item.txId] ?? 0
                        const title = titleOf(item.txId)
                        return (
                          <div key={item.txId} className={`alloc${on ? ' on' : ''}`}>
                            <button type="button" className="atog" aria-pressed={on} aria-label={title} onClick={() => tap(item.txId)}>
                              <span className="ck" aria-hidden="true">
                                ✓
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <div className="small b" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {title}
                                </div>
                                <div className="xs muted">
                                  {dayLabel(item.date)} · {live.ownerIds.length > 1 && item.ownerId ? `${nameOf(item.ownerId)} · ` : ''}
                                  {fmt(item.open)} open
                                </div>
                              </span>
                            </button>
                            <input
                              className="inp num"
                              inputMode="numeric"
                              aria-label={`Amount for ${title}`}
                              value={on ? value.toLocaleString('id-ID') : ''}
                              placeholder="0"
                              disabled={!on}
                              onChange={(e) => setDraft(setAllocation(live, item.txId, typedRupiah(e.target.value)))}
                            />
                            {on && value < item.open && (
                              <button type="button" className="link xs full" onClick={() => full(item.txId)}>
                                Pay full
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </>
        ) : (
          <div className="box empty small">Pick whose charges this payment was for.</div>
        )}

        {deletable && (
          <button type="button" className="link" style={{ color: 'var(--bad)', alignSelf: 'center' }} onClick={() => setStep('delete')}>
            Delete payment
          </button>
        )}

        <div className="foot" aria-label="Assigned">
          <div className="row small">
            <span>Assigned</span>
            <b className="num">
              {fmt(check.assigned)} of {fmt(live.amount)}
            </b>
          </div>
          {check.overPayment && (
            <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
              That&apos;s {fmt(-check.left)} more than the payment. Lower an amount.
            </div>
          )}
          {check.overCharges.length > 0 && (
            <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
              More than is open on {check.overCharges.map(titleOf).join(', ')}. Lower it or tap Pay full.
            </div>
          )}
          {check.left > 0 && (
            <>
              <div className="small">
                <b>{fmt(check.left)} left over.</b> Keep it as a deposit for someone? It works like a top-up: their charges from {live.date ? dayLabel(live.date) : 'the payment date'} on are paid from it automatically,
                oldest first.
              </div>
              <div className="chips" role="group" aria-label="Leftover">
                {owners
                  .filter((o) => !o.archived || o.id === deposit)
                  .map((o) => (
                    <button key={o.id} type="button" className="chip mini" aria-pressed={deposit === o.id} onClick={() => setDeposit(o.id)}>
                      {o.name}
                    </button>
                  ))}
                <button type="button" className="chip mini" aria-pressed={deposit === null} onClick={() => setDeposit(null)}>
                  Decide later
                </button>
              </div>
            </>
          )}
          {error && (
            <div className="small err" role="alert">
              {error}
            </div>
          )}
          <div className="btns">
            <button type="button" className="btn ghost" onClick={leave}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={!check.canSave || busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>

      {step === 'delete' && payment && <DeleteSheet ledger={ledger} payment={payment} busy={busy} duplicateOf={status?.kind === 'possibleDuplicate' ? ledger.payments.find((x) => x.id === status.lineId) : undefined} onClose={() => setStep(null)} onDelete={() => run(async () => {
        await removePayment(db, payment.id)
        toast('Payment deleted')
        leave()
      })} />}
      {step === 'keepBoth' && payment && (
        <Sheet title="Keep both payments?" onClose={() => setStep(null)}>
          <div className="small">
            Only if you made two transfers. If the bank line is this same transfer, the money is counted twice and the bills come out too low.
          </div>
          <div className="btns">
            <button type="button" className="btn ghost" onClick={() => setStep(null)}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={busy} onClick={() => run(async () => {
              await keepPaymentWaiting(db, payment.id)
              toast('Kept both. This one waits for its own bank line.')
              leave()
            })}>
              Keep both
            </button>
          </div>
        </Sheet>
      )}
      {step === 'move' && payment && (
        <Sheet title="Paid to which card?" onClose={() => setStep(null)}>
          <div className="xs muted">The payment moves there without its assignments. Assign it on that card.</div>
          <Effects ledger={ledger} paymentId={payment.id} />
          <div className="opts">
            {otherCards.map((c) => (
              <button key={c.card.id} type="button" className="opt" disabled={busy} onClick={() => run(async () => {
                const r = await movePayment(db, payment.id, c.card.id)
                selectCard(c.card.id)
                toast(r.linkedTo ? `Moved to ${c.card.name} and matched to its bank line of ${dayLabel(r.linkedTo.date)}.` : `Moved to ${c.card.name}. Assign it there.`)
                leave()
              })}>
                <span>
                  {c.card.name}
                  <span className="s">{c.card.bank}</span>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  )
}

/** What taking a payment off this card undoes (deleting or moving it): unpaid charges, bank line, statements back to Draft. */
function Effects({ ledger, paymentId }: { ledger: Ledger; paymentId: string }) {
  const effect = deleteEffect(ledger, paymentId)
  const warning = draftWarning(effect.drafts)
  return (
    <>
      {effect.unpaid.length > 0 ? (
        <div className="box tight" aria-label="Becomes unpaid">
          <div className="lbl">Becomes unpaid</div>
          {effect.unpaid.map(({ tx, after }) => (
            <div key={tx.id} className="row small">
              <span>
                {dayLabel(tx.date)} · {tx.label ?? tx.description}
              </span>
              <span className="num">{fmt(after)} left</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="xs muted">No charge becomes unpaid.</div>
      )}
      {effect.bankLine && <div className="xs">The bank line of {dayLabel(effect.bankLine.date)} ({rp(effect.bankLine.amount)}) goes back to To assign.</div>}
      {warning && (
        <div className="status draft">
          <div className="xs">{warning}</div>
        </div>
      )}
    </>
  )
}

interface DeleteSheetProps {
  ledger: Ledger
  payment: Payment
  busy: boolean
  /** Possible duplicate: the already-assigned bank line it may repeat. */
  duplicateOf?: Payment
  onClose(): void
  onDelete(): void
}

function DeleteSheet({ ledger, payment, busy, duplicateOf, onClose, onDelete }: DeleteSheetProps) {
  return (
    <Sheet title="Delete this payment?" onClose={onClose} locked={busy}>
      <div className="small">
        {dayLabel(payment.date)} · {rp(payment.amount)}
      </div>
      <Effects ledger={ledger} paymentId={payment.id} />
      {duplicateOf && (
        <div className="xs">
          The bank line of {dayLabel(duplicateOf.date)} ({rp(duplicateOf.amount)}) keeps its assignments.
        </div>
      )}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Keep it
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </Sheet>
  )
}
