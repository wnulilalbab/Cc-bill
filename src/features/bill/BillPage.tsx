// Bill, the home screen (docs/intent/phase-1.md §8; layout and wording from the prototype): card switcher with each
// card's total, statement picker, Draft/Final with jump links, the "To pay" hero and one row per person. Every number
// comes from the domain (cardBill / ownerBill) through ./view.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Picker } from '../../components/Picker'
import { useToast } from '../../components/Toast'
import { unassignedOf } from '../../domain/amounts'
import { cardBill, type OwnerBill } from '../../domain/bill'
import { draftIssues } from '../../domain/draft'
import { canAcceptSign, sum } from '../../domain/money'
import { reconcileStatement } from '../../domain/reconcile'
import type { Ledger, Statement } from '../../domain/types'
import type { ShareTarget } from '../../domain/share/message'
import type { CardRecord, OwnerRecord } from '../../data/cards'
import { acceptRebate } from '../../data/transactions'
import { useData } from '../data/DataContext'
import { ownerColor } from '../look/palettes'
import { OwnerChip } from '../settings/SettingsPage'
import { rp } from '../settings/format'
import { ShareSheet } from '../share/ShareSheet'
import { dayLabel, fmt, statementName, statementsForPicker } from '../transactions/view'
import { TopBar } from '../shell/TopBar'
import { CardSwitcher, type CardTile } from './CardSwitcher'
import { statementFor, todayIso, useBill } from './useBill'
import { billView, monthName, shortMonth, type BillView } from './view'

/** "+ 5.000" / "− 5.000" (an older refund credit is negative). */
export const signed = (n: number) => `${n < 0 ? '−' : '+'} ${fmt(Math.abs(n))}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const shortDay = (iso: string) => dayLabel(iso).slice(0, -5)

/** Path segment for rows without an owner. Real owner ids are generated ("owner-…"), so this can't collide. */
export const NO_OWNER = '_none'
/** Also accepted in a typed or shared link: /bill/person/none. */
export const NO_OWNER_ALIAS = 'none'
export const personPath = (ownerId: string | null, statementId: string) =>
  `/bill/person/${encodeURIComponent(ownerId ?? NO_OWNER)}?s=${encodeURIComponent(statementId)}`
export const txPath = (statementId: string, extra: Record<string, string> = {}) => `/transactions?${new URLSearchParams({ statement: statementId, ...extra })}`
/** The Payments list, or one payment's full-screen assign page (Slice 9 routes). */
export const payPath = (paymentId?: string) => (paymentId ? `/payments/${encodeURIComponent(paymentId)}` : '/payments')

/** A card with no billed statement and nothing in Unbilled has nothing to bill yet. */
export const isEmptyCard = (l: Ledger) => !l.statements.some((s) => s.kind === 'billed') && l.transactions.length === 0 && l.payments.length === 0

function tileCaption(s: Statement | undefined, l: Ledger): string {
  if (!s || isEmptyCard(l)) return 'No statement yet'
  return s.kind === 'unbilled' ? 'Open incl. unbilled' : `${monthName(s)} bill · due ${shortDay(s.dueDate)}`
}

export function BillPage() {
  const { cards, selected, selectCard, ledgers, ledger, statement, setStatement } = useBill()

  if (!cards) return <div className="screen small muted">Loading…</div>
  if (!selected) {
    return (
      <div className="screen">
        <Top />
        <div className="box empty">
          <div>No cards yet. Add your card, its owners and its palette first.</div>
          <Link className="btn acc" to="/settings">
            Add a card
          </Link>
        </div>
      </div>
    )
  }

  const tiles: CardTile[] = cards.map((c) => {
    const l = ledgers?.[c.card.id]
    const s = l && (c.card.id === selected.card.id ? statement : statementFor(l, c.card.id, null))
    const total = l && s && !isEmptyCard(l) ? cardBill(l, c.owners.map((o) => o.id), s.id, todayIso()).total : null
    return { id: c.card.id, name: c.card.name, bank: c.card.bank, last4: c.card.last4, palette: c.card.palette, caption: l ? tileCaption(s, l) : 'Loading…', total }
  })

  return (
    <div className="screen">
      <Top />
      <CardSwitcher tiles={tiles} selectedId={selected.card.id} onSelect={selectCard} />
      {!ledger || !statement ? (
        <div className="small muted">Loading…</div>
      ) : isEmptyCard(ledger) ? (
        <div className="box empty">
          <div>No statements on this card yet.</div>
          <Link className="btn acc" to="/import">
            Import the first one
          </Link>
        </div>
      ) : (
        <Bill ledger={ledger} statement={statement} owners={selected.owners} card={selected.card} onStatement={setStatement} />
      )}
    </div>
  )
}

function Top() {
  return <TopBar title="Bill" />
}

function Bill({ ledger, statement, owners, card, onStatement }: { ledger: Ledger; statement: Statement; owners: OwnerRecord[]; card: CardRecord; onStatement(id: string): void }) {
  const today = todayIso()
  const bank = card.bank
  const [sharing, setSharing] = useState<ShareTarget | null>(null)
  const view = billView(ledger, owners.map((o) => o.id), statement.id, today)
  const un = statement.kind === 'unbilled'
  const name = monthName(statement)
  const totals = statement.kind === 'billed' ? reconcileStatement(ledger, statement.id) : null
  return (
    <>
      <div className="row">
        <Picker
          title="Statement"
          value={statement.id}
          options={statementsForPicker(ledger.statements).map((s) => ({
            value: s.id,
            label: statementName(s),
            sub: s.kind === 'unbilled' ? 'Not on a statement yet' : `Closed ${dayLabel(s.statementDate)} · due ${dayLabel(s.dueDate)}`,
          }))}
          onChange={onStatement}
        />
        {statement.kind === 'unbilled' ? <span className="pill">Not billed yet</span> : <span className="pill">Due {dayLabel(statement.dueDate)}</span>}
      </div>

      <DraftPanel ledger={ledger} statement={statement} />

      <HeroBox
        view={view}
        bank={bank}
        label={un ? 'Open now, incl. older bills' : `To pay for the ${name} bill`}
        chargesLabel={un ? 'Unbilled charges' : `${name} charges`}
        totalsDifference={totals && !totals.ok ? totals.difference : undefined}
        creditHint
        onShare={() => setSharing('all')}
        shareLabel="Share everyone's bill"
      />
      <div className="note">
        As of {dayLabel(today)}. Paid amounts are live, so a payment made later still reduces this bill. Installments still to come are counted as of this statement.
      </div>

      <div className="row">
        <span className="lbl">By person</span>
        <button type="button" className="link" onClick={() => setSharing('all')}>
          Share all
        </button>
      </div>
      {view.shown.length ? (
        view.shown.map((b) => <OwnerRow key={b.ownerId ?? 'none'} bill={b} owners={owners} statement={statement} onShare={() => setSharing({ ownerId: b.ownerId })} />)
      ) : (
        <div className="box empty small">Nothing on this {un ? 'bucket' : 'bill'} yet.</div>
      )}
      <div className="btns">
        <Link className="btn ghost" to={txPath(statement.id)}>
          Transactions
        </Link>
        <Link className="btn ghost" to={payPath()}>
          Payments
        </Link>
      </div>
      {sharing && <ShareSheet ledger={ledger} card={card} owners={owners} statementId={statement.id} initialTarget={sharing} today={today} onClose={() => setSharing(null)} />}
    </>
  )
}

export function HeroBox({
  view,
  bank,
  label,
  chargesLabel,
  totalsDifference,
  creditHint,
  onShare,
  shareLabel = 'Share',
}: {
  view: Pick<BillView, 'hero'>
  bank?: string
  label: string
  chargesLabel: string
  /** The statement's totals check difference (printed vs rows), when not 0. */
  totalsDifference?: number
  /** Card hero: explain why a credit makes the total higher than the bank balance. */
  creditHint?: boolean
  /** Shows a Share button in the hero (opens the share sheet). */
  onShare?(): void
  shareLabel?: string
}) {
  const h = view.hero
  return (
    <div className="hero" aria-label="To pay">
      {bank && <span className="accchip">{bank}</span>}
      <div className="sub">{label}</div>
      <div className="big num">{h.settled ? <span>Paid ✓</span> : rp(h.total)}</div>
      {h.settled && <div className="xs">Everything on this bill is paid.</div>}
      <hr />
      <Line label={chargesLabel} value={fmt(h.charges)} strong />
      <Line label="Already paid" value={`− ${fmt(h.alreadyPaid)}`} strong />
      <Line label="Left on these charges" value={fmt(h.left)} />
      <Line label="Still unpaid from older bills" value={signed(h.olderRemaining)} strong />
      {h.credit > 0 && <Line label="Credit carried forward (refunds larger than charges)" value={`+ ${fmt(h.credit)}`} strong />}
      {h.depositWaiting > 0 && <Line label="Deposit waiting for new charges" value={fmt(h.depositWaiting)} />}
      {h.installmentsToCome > 0 && <Line label="Installments still to come (not due)" value={fmt(h.installmentsToCome)} />}
      {creditHint && h.credit > 0 && (
        <div className="xs" aria-label="Credit hint">
          This total is {rp(h.credit)} above what the bank shows: that is a refund credit kept for its owner, not taken off anyone else&apos;s bill.
        </div>
      )}
      {totalsDifference !== undefined && (
        <div className="xs warn-text" aria-label="Totals warning">
          Totals differ from the bank by {rp(Math.abs(totalsDifference))}.
        </div>
      )}
      {onShare && (
        <button type="button" className="btn acc" aria-label={shareLabel} onClick={onShare}>
          Share to WhatsApp
        </button>
      )}
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="line">
      <span>{label}</span>
      {strong ? <b className="num">{value}</b> : <span className="num">{value}</span>}
    </div>
  )
}

export function ownerLabel(owners: readonly OwnerRecord[], ownerId: string | null) {
  const i = owners.findIndex((o) => o.id === ownerId)
  const o = owners[i]
  return o ? { name: o.name, chip: <OwnerChip name={o.name} color={o.color ?? ownerColor(i)} archived={o.archived} /> } : { name: 'No owner', chip: <span className="pill">No owner</span> }
}

function OwnerRow({ bill: b, owners, statement, onShare }: { bill: OwnerBill; owners: OwnerRecord[]; statement: Statement; onShare(): void }) {
  const { name, chip } = ownerLabel(owners, b.ownerId)
  const month = statement.kind === 'unbilled' ? 'Unbilled' : shortMonth(statement)
  return (
    <div className="orow-wrap">
    <Link className="orow" to={personPath(b.ownerId, statement.id)} aria-label={`${name}: ${b.settled ? 'Paid' : rp(b.mustPay)}`}>
      <div className="row">
        {chip}
        <span className="amt num">{b.settled ? <span style={{ color: 'var(--ok)' }}>Paid ✓</span> : rp(b.mustPay)}</span>
      </div>
      <div className="kv">
        <span>{month} charges</span>
        <span>{fmt(b.charges)}</span>
        {b.alreadyPaid > 0 && (
          <>
            <span>Already paid</span>
            <span>− {fmt(b.alreadyPaid)}</span>
          </>
        )}
        <span>Left</span>
        <span>{fmt(b.thisRemaining)}</span>
        {b.olderRemaining !== 0 && (
          <>
            <span>Unpaid from {b.older.map((g) => shortMonth(g.statement)).join(', ')}</span>
            <span>{signed(b.olderRemaining)}</span>
          </>
        )}
        {b.credit > 0 && (
          <>
            <span>Credit</span>
            <span style={{ color: 'var(--ok)' }}>{fmt(b.credit)}</span>
          </>
        )}
        {b.depositWaiting > 0 && (
          <>
            <span>Deposit left</span>
            <span className="muted">{fmt(b.depositWaiting)}</span>
          </>
        )}
        {b.installmentsToComeTotal > 0 && (
          <>
            <span>Installments to come</span>
            <span className="muted">{fmt(b.installmentsToComeTotal)}</span>
          </>
        )}
      </div>
    </Link>
    <button type="button" className="link xs orow-share" aria-label={`Share ${name}'s bill`} onClick={onShare}>
      Share
    </button>
    </div>
  )
}

/** Draft vs Final for the selected statement (domain draftIssues), each item with its jump link. */
function DraftPanel({ ledger, statement }: { ledger: Ledger; statement: Statement }) {
  const { db } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const issues = draftIssues(ledger, statement.id)
  const totals = statement.kind === 'billed' ? reconcileStatement(ledger, statement.id) : null
  if (issues.final) {
    // A difference the user confirmed at import does not block Final, but it stays visible.
    if (totals && !totals.ok) {
      return (
        <div className="status draft" aria-label="Draft or Final">
          <h3>Final, but totals differ from the bank by {rp(Math.abs(totals.difference))}</h3>
          <div className="xs">Every row checked and every payment assigned. Fix or add rows in Transactions if the bank&apos;s figure is right.</div>
          <Link className="link" to={txPath(statement.id)}>
            Open in Transactions
          </Link>
        </div>
      )
    }
    return (
      <div className="status final" aria-label="Draft or Final">
        <h3>Final ✓</h3>
        <div className="xs">Every row checked and every payment assigned{totals ? '. Totals match the bank.' : '.'}</div>
      </div>
    )
  }
  const tx = (id: string) => ledger.transactions.find((t) => t.id === id)!
  const pay = (id: string) => ledger.payments.find((p) => p.id === id)!
  const unbilledId = ledger.statements.find((s) => s.kind === 'unbilled' && s.cardId === statement.cardId)?.id ?? statement.id
  const accept = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      await acceptRebate(db, id)
      toast('Accepted as a rebate')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const payItem = (ids: string[], text: string, action: string) =>
    ids.length > 0 && (
      <li className="it">
        <span>{text}</span>
        <Link className="link" to={payPath(ids[0])}>
          {action}
        </Link>
      </li>
    )
  return (
    <div className="status draft" aria-label="Draft or Final">
      <h3>Draft · {issues.count} to finish</h3>
      <ul className="issues">
        {issues.checkRows.length > 0 && (
          <li className="it">
            <span>{issues.checkRows.length === 1 ? '1 row needs a check' : `${issues.checkRows.length} rows need a check`}</span>
            <Link className="link" to={txPath(statement.id, { status: 'check' })}>
              Review
            </Link>
          </li>
        )}
        {issues.wrongSignRows.map((id) => {
          const t = tx(id)
          const rebate = canAcceptSign(t.kind, t.amount)
          return (
            <li key={id} className="it">
              <span>
                {rebate ? `Negative ${t.kind === 'fee' ? 'fee' : 'interest'}` : 'Sign looks wrong'}: {t.label ?? t.description} {fmt(t.amount)}
              </span>
              <span className="chips">
                {rebate && (
                  <button type="button" className="chip mini" disabled={busy} onClick={() => accept(id)}>
                    Accept as rebate
                  </button>
                )}
                <Link className="link" to={txPath(statement.id, { row: id })}>
                  Fix
                </Link>
              </span>
            </li>
          )
        })}
        {payItem(issues.blockingPayments, `${plural(issues.blockingPayments.length, 'payment')} not assigned (${rp(sum(issues.blockingPayments.map((id) => unassignedOf(pay(id)))))})`, 'Assign')}
        {payItem(issues.missingPayments, `${plural(issues.missingPayments.length, 'payment')} you recorded ${issues.missingPayments.length === 1 ? "isn't" : "aren't"} on a statement`, 'Resolve')}
        {payItem(issues.possibleDuplicatePayments, `${plural(issues.possibleDuplicatePayments.length, 'payment')} may be the same money as a bank line`, 'Check')}
        {issues.notOnStatementRows.length > 0 && (
          <li className="it">
            <span>
              {plural(issues.notOnStatementRows.length, 'unbilled charge')} didn&apos;t show up on the {monthName(statement)} statement
            </span>
            <Link className="link" to={txPath(unbilledId, { row: issues.notOnStatementRows[0] })}>
              Resolve
            </Link>
          </li>
        )}
        {payItem(issues.notOnStatementPayments, `${plural(issues.notOnStatementPayments.length, 'unbilled payment')} didn't show up on the ${monthName(statement)} statement`, 'Resolve')}
      </ul>
      <div className="xs">Amounts per person can still change until these are done.</div>
    </div>
  )
}
