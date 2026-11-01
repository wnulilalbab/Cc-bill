// Payments (docs/intent/phase-1.md §7; layout and wording from the prototype): card picker, the tabs To assign /
// Assigned / Not on a statement / Possible duplicates / Deposits, each payment opening the full-screen assign page,
// and "+ Record a payment by hand".
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Picker } from '../../components/Picker'
import { computeMoney } from '../../domain/amounts'
import type { Ledger, Payment } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import { loadLedger } from '../../data/repo'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { ownerColor } from '../look/palettes'
import { OwnerChip } from '../settings/SettingsPage'
import { rp } from '../settings/format'
import { dayLabel, fmt } from '../transactions/view'
import { allocLabel, bankLabel, ownerDeposits, paymentLists, paymentOwners, sourceLine, TAB_LABEL, toAssignTotal, type Label, type ListTab, type PaymentsTab } from './view'

const TABS: PaymentsTab[] = ['toAssign', 'assigned', 'notOnStatement', 'duplicates', 'deposits']

const EMPTY: Record<PaymentsTab, string> = {
  toAssign: 'Nothing to assign. Every payment is assigned or kept as a deposit.',
  assigned: 'Nothing yet.',
  notOnStatement: 'Every payment you recorded is on a statement.',
  duplicates: 'No payment looks like it was counted twice.',
  deposits: 'No deposits. A leftover kept for someone shows here.',
}

export function Pill({ label }: { label: Label }) {
  return <span className={`pill${label.tone ? ` ${label.tone}` : ''}`}>{label.text}</span>
}

export function ownerLook(owners: readonly OwnerRecord[], id: string) {
  const i = owners.findIndex((o) => o.id === id)
  const o = owners[i]
  return { name: o?.name ?? 'Unknown', color: o?.color ?? ownerColor(Math.max(0, i)), archived: o?.archived }
}

export function PaymentsPage() {
  const { db } = useData()
  const { cards, selected, selectCard } = useAppearance()
  const cardId = selected?.card.id
  const loaded = useDbQuery(async () => (cardId ? { cardId, ledger: await loadLedger(db, cardId) } : null), [db, cardId])
  const ledger = loaded && loaded.cardId === cardId ? loaded.ledger : undefined
  const [tab, setTab] = useState<PaymentsTab>('toAssign')
  const owners: OwnerRecord[] = useMemo(() => selected?.owners ?? [], [selected])
  const lists = useMemo(() => (ledger && cardId ? paymentLists(ledger, cardId) : undefined), [ledger, cardId])
  const state = useMemo(() => (ledger ? computeMoney(ledger) : undefined), [ledger])
  const deposits = useMemo(() => (ledger && cardId && state ? ownerDeposits(ledger, cardId, owners.map((o) => o.id), state) : []), [ledger, cardId, owners, state])

  if (!cards) return <div className="screen small muted">Loading…</div>
  if (!selected || !cardId) {
    return (
      <div className="screen">
        <Header />
        <div className="box empty">Add a card in Settings first.</div>
      </div>
    )
  }
  const count = (t: PaymentsTab) => (t === 'deposits' ? deposits.length : (lists?.[t].length ?? 0))

  return (
    <div className="screen">
      <Header />
      <Picker
        title="Card"
        value={cardId}
        options={cards.map((c) => ({ value: c.card.id, label: c.card.name, sub: `${c.card.bank}${c.card.last4 ? ` •••• ${c.card.last4}` : ''}` }))}
        onChange={selectCard}
        field
      />
      <div className="note">
        Payments come in by themselves from statements and unbilled screenshots. Tell the app what each one paid for. You only record one by hand if you can&apos;t
        wait for the bank.
      </div>

      <div className="filters" role="tablist" aria-label="Payments">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" className="chip" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {count(t) > 0 && ` · ${count(t)}`}
          </button>
        ))}
      </div>

      {!ledger || !lists || !state ? (
        <div className="small muted">Loading…</div>
      ) : (
        <div role="tabpanel" aria-label={TAB_LABEL[tab]} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tab === 'toAssign' && lists.toAssign.length > 0 && <div className="xs muted">{rp(toAssignTotal(lists.toAssign))} still to assign.</div>}
          {tab === 'duplicates' && lists.duplicates.length > 0 && (
            <div className="xs muted">You recorded these by hand, and the bank shows a line of the same amount within 5 days that is already assigned. It may be the same money counted twice.</div>
          )}
          {tab === 'deposits'
            ? deposits.map((d) => <DepositCard key={d.ownerId} deposit={d} owners={owners} />)
            : lists[tab as ListTab].map((p) => <PaymentRow key={p.id} payment={p} ledger={ledger} owners={owners} state={state} />)}
          {count(tab) === 0 && <div className="box empty small">{EMPTY[tab]}</div>}
        </div>
      )}

      <Link className="btn ghost" to="/v2/payments/new">
        + Record a payment by hand
      </Link>
    </div>
  )
}

function Header() {
  return (
    <>
      <div className="top">
        <h1>Payments</h1>
      </div>
      <Link className="note" to="/payments">
        Old payments screen
      </Link>
    </>
  )
}

function Who({ ledger, payment, owners }: { ledger: Ledger; payment: Payment; owners: readonly OwnerRecord[] }) {
  const paid = paymentOwners(ledger, payment)
  const ids = paid.length ? paid : (payment.forOwnerIds ?? [])
  if (!ids.length) return <span className="pill">No one picked yet</span>
  return (
    <>
      {ids.map((id) => {
        const o = ownerLook(owners, id)
        return <OwnerChip key={id} name={o.name} color={o.color} archived={o.archived} />
      })}
      {!paid.length && <span className="pill">intended</span>}
    </>
  )
}

function PaymentRow({ payment: p, ledger, owners, state }: { payment: Payment; ledger: Ledger; owners: readonly OwnerRecord[]; state: ReturnType<typeof computeMoney> }) {
  return (
    <Link className="orow" to={`/v2/payments/${encodeURIComponent(p.id)}`} aria-label={`${rp(p.amount)} ${dayLabel(p.date)}`}>
      <div className="row">
        <span className="amt num b">{rp(p.amount)}</span>
        <span className="xs muted">{dayLabel(p.date)}</span>
      </div>
      <div className="xs muted">{sourceLine(ledger, p)}</div>
      <div className="chips">
        <Who ledger={ledger} payment={p} owners={owners} />
      </div>
      <div className="chips">
        <Pill label={allocLabel(state, p, (id) => ownerLook(owners, id).name)} />
        <Pill label={bankLabel(ledger, p)} />
      </div>
    </Link>
  )
}

function DepositCard({ deposit: d, owners }: { deposit: ReturnType<typeof ownerDeposits>[number]; owners: readonly OwnerRecord[] }) {
  const o = ownerLook(owners, d.ownerId)
  return (
    <section className="box tight" aria-label={`${o.name}'s deposit`}>
      <div className="row">
        <OwnerChip name={o.name} color={o.color} archived={o.archived} />
        <span className="small">
          Deposit left <b className="num">{d.left > 0 ? rp(d.left) : 'used, 0 left'}</b>
        </span>
      </div>
      {d.payments.map(({ payment, kept, used, left }) => (
        <Link key={payment.id} className="row small" to={`/v2/payments/${encodeURIComponent(payment.id)}`}>
          <span>
            {dayLabel(payment.date)} · kept {fmt(kept)}
          </span>
          <span className="num muted">
            {fmt(used)} used · {fmt(left)} left
          </span>
        </Link>
      ))}
      <div className="lbl">Paid from the deposit</div>
      {d.charges.length ? (
        d.charges.map(({ tx, amount }) => (
          <div key={tx.id} className="row small">
            <span>
              {dayLabel(tx.date)} · {tx.label ?? tx.description}
            </span>
            <span className="num" style={{ color: 'var(--ok)' }}>
              − {fmt(amount)}
            </span>
          </div>
        ))
      ) : (
        <div className="xs muted">Nothing yet. {o.name}&apos;s charges from the payment date on are paid from it automatically, oldest first.</div>
      )}
    </section>
  )
}
