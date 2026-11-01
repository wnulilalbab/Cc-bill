// One person's bill (docs/intent/phase-1.md §8, prototype "owner detail"): this statement's charges grouped by kind
// with what paid each one ("after due" marked), the payments and deposits behind "Already paid", carried credit,
// older unpaid bills, not billed yet and installments to come. Lines add up to the hero numbers (M-10).
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BackIcon } from '../../components/icons'
import { computeMoney } from '../../domain/amounts'
import { coverageOf, ownerBill, type BillLine, type OwnerBill } from '../../domain/bill'
import type { Ledger, Payment, Statement } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import { rp } from '../settings/format'
import { StatusPill } from '../transactions/RowSheet'
import { dayLabel, fmt, MONTHS, statementName, TAG_SOURCE_LABEL } from '../transactions/view'
import { HeroBox, NO_OWNER, ownerLabel, payPath, txPath } from './BillPage'
import { todayIso, useBill } from './useBill'
import { groupByKind, KIND_GROUP_LABEL, monthName, personPayments, type Hero } from './view'

const payLine = (p: Payment) => p.description ?? (p.source === 'manual' ? 'Recorded by you' : 'Bank payment')

export function PersonPage() {
  const { ownerId: param } = useParams()
  const { selected, ledger, statement } = useBill()
  const ownerId = param === NO_OWNER ? null : (param ?? null)

  if (!selected || !ledger || !statement) return <div className="screen small muted">Loading…</div>
  const known = ownerId === null || selected.owners.some((o) => o.id === ownerId)
  if (!known) {
    return (
      <div className="screen">
        <Header title="Person" sub={selected.card.name} statementId={statement.id} />
        <div className="box empty">This person is not on the {selected.card.name} card.</div>
      </div>
    )
  }
  return <Person ledger={ledger} statement={statement} ownerId={ownerId} owners={selected.owners} cardName={selected.card.name} />
}

function Header({ title, sub, statementId }: { title: string; sub: string; statementId: string }) {
  const navigate = useNavigate()
  return (
    <div className="top">
      <button
        type="button"
        className="iconbtn"
        aria-label="Back"
        onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate(`/v2/bill?s=${encodeURIComponent(statementId)}`))}
      >
        <BackIcon />
      </button>
      <div style={{ textAlign: 'center', minWidth: 0 }}>
        <div className="xs muted">{sub}</div>
        <h1>{title}</h1>
      </div>
      <span style={{ width: 38 }} />
    </div>
  )
}

function heroOf(b: OwnerBill): Hero {
  return {
    total: b.mustPay,
    charges: b.charges,
    alreadyPaid: b.alreadyPaid,
    left: b.thisRemaining,
    olderRemaining: b.olderRemaining,
    credit: b.credit,
    depositWaiting: b.depositWaiting,
    installmentsToCome: b.installmentsToComeTotal,
    settled: b.settled,
  }
}

function Person({ ledger, statement, ownerId, owners, cardName }: { ledger: Ledger; statement: Statement; ownerId: string | null; owners: OwnerRecord[]; cardName: string }) {
  const state = computeMoney(ledger)
  const bill = ownerBill(ledger, ownerId, statement.id, todayIso(), state)
  const { name } = ownerLabel(owners, ownerId)
  const un = statement.kind === 'unbilled'
  const month = monthName(statement)
  const pays = personPayments(ledger, bill, state)
  const groups = groupByKind(bill.lines)
  const planName = (id: string) => ledger.plans.find((p) => p.id === id)?.name ?? 'Installment plan'
  const monthly = (id: string) => ledger.plans.find((p) => p.id === id)?.monthly ?? 0

  return (
    <div className="screen">
      <Header title={name} sub={`${cardName} · ${un ? 'Unbilled' : `${month} bill`}`} statementId={statement.id} />
      <HeroBox view={{ hero: heroOf(bill) }} label={`To pay for the ${un ? 'unbilled' : month} bill`} chargesLabel={`${month} charges`} />

      <div className="lbl">
        {statementName(statement)} · {bill.lines.length} {bill.lines.length === 1 ? 'item' : 'items'}
      </div>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.kind} aria-label={KIND_GROUP_LABEL[g.kind]} className="box tight">
            <div className="row small">
              <b>{KIND_GROUP_LABEL[g.kind]}</b>
              <span className="num b">{fmt(g.total)}</span>
            </div>
            <div className="txlist">
              {g.lines.map((l) => (
                <LineRow key={l.tx.id} line={l} ledger={ledger} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="box empty small">Nothing on this statement.</div>
      )}

      <section className="box tight" aria-label="Payments for this bill">
        <div className="lbl">Paid on these charges</div>
        {pays.payments.map((s) => (
          <div key={s.payment.id} className="row small">
            <Link to={payPath(s.payment.id)} style={{ color: 'inherit' }}>
              {dayLabel(s.payment.date)} · {payLine(s.payment)}
              {s.afterDue && <span className="pill warn"> after due</span>}
            </Link>
            <span className="num" style={{ color: 'var(--ok)' }}>
              − {fmt(s.amount)}
            </span>
          </div>
        ))}
        {pays.fromDeposit > 0 && (
          <div className="row small">
            <span>From {name}&apos;s deposit</span>
            <span className="num" style={{ color: 'var(--ok)' }}>
              − {fmt(pays.fromDeposit)}
            </span>
          </div>
        )}
        {!pays.payments.length && !pays.fromDeposit && <div className="small muted">No payment covers these charges yet.</div>}
        <div className="row small">
          <b>Already paid</b>
          <b className="num">− {fmt(bill.alreadyPaid)}</b>
        </div>
        <Link className="link" to={payPath()}>
          Open Payments
        </Link>
      </section>

      {pays.deposits.length > 0 && (
        <section className="box tight" aria-label="Deposits">
          <div className="lbl">Deposits</div>
          {pays.deposits.map((d) => (
            <div key={d.payment.id} className="row small">
              <span>
                {dayLabel(d.payment.date)} payment · {fmt(d.amount)} kept for {name}
                <span className="xs muted"> · used {fmt(d.used)}</span>
              </span>
              <span className={`pill${d.left ? '' : ' ok'}`}>{d.left ? `${fmt(d.left)} left` : 'used, 0 left'}</span>
            </div>
          ))}
          <div className="xs muted">A deposit pays {name}&apos;s charges dated on or after the payment, oldest first.</div>
        </section>
      )}

      {bill.credit > 0 && (
        <div className="status final" aria-label="Credit">
          <h3>Credit {rp(bill.credit)}</h3>
          <div className="xs">Refunds are larger than {name}&apos;s charges. The credit carries forward and lowers the next bill.</div>
        </div>
      )}

      {bill.older.length > 0 && (
        <>
          <div className="lbl">Still unpaid from older bills</div>
          {bill.older.map((g) => (
            <section key={g.statement.id} aria-label={`${monthName(g.statement)} statement`} className="box tight">
              <div className="row small">
                <b>{statementName(g.statement)}</b>
                <span className="num b">{g.remaining < 0 ? `Credit ${fmt(-g.remaining)}` : fmt(g.remaining)}</span>
              </div>
              <div className="txlist">
                {g.lines.map((l) => (
                  <LineRow key={l.tx.id} line={l} ledger={ledger} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {bill.notBilledYet.length > 0 && (
        <>
          <div className="lbl">Not billed yet (for information)</div>
          <div className="txlist">
            {bill.notBilledYet.map((l) => (
              <LineRow key={l.tx.id} line={l} ledger={ledger} />
            ))}
          </div>
        </>
      )}

      {bill.installmentsToCome.length > 0 && (
        <section className="box tight" aria-label="Installments still to come">
          <div className="lbl">Installments still to come</div>
          {bill.installmentsToCome.map((f) => (
            <div key={f.planId} className="row small">
              <span>
                {planName(f.planId)} · {f.monthsLeft} {f.monthsLeft === 1 ? 'month' : 'months'} left × {fmt(monthly(f.planId))}
              </span>
              <b className="num">{fmt(f.amount)}</b>
            </div>
          ))}
        </section>
      )}

      <Link className="btn ghost" to={txPath(statement.id)}>
        Open in Transactions
      </Link>
    </div>
  )
}

function LineRow({ line: l, ledger }: { line: BillLine; ledger: Ledger }) {
  const t = l.tx
  const c = l.effective > 0 ? coverageOf(ledger, t.id) : null
  const dead = l.status === 'notCounted'
  return (
    <div className="tx" aria-label={`${t.label ?? t.description} ${fmt(t.amount)}`}>
      <span className="date">
        <b>{Number(t.date.slice(8, 10))}</b>
        <span>{MONTHS[Number(t.date.slice(5, 7)) - 1]}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="ttl">{t.label ?? t.description}</div>
        {t.label && <div className="raw">{t.description}</div>}
        <div className="tags">
          {t.installment && (
            <span className="pill acc">
              Installment {t.installment.n}/{t.installment.of}
            </span>
          )}
          {t.cancelled && <span className="pill acc">Moved to installment</span>}
          {t.kind === 'reversal' && <span className="pill acc">Reversal</span>}
          {t.check ? <span className="pill warn">● Check</span> : t.tagSource && <span className="pill">{TAG_SOURCE_LABEL[t.tagSource]}</span>}
        </div>
        {c && (c.payments.length > 0 || c.fromDeposit > 0) && (
          <div className="xs muted">
            {c.payments.map((p) => (
              <div key={p.paymentId}>
                Paid {fmt(p.amount)} on {dayLabel(p.date)}
                {p.afterDue && <span className="pill warn"> after due</span>}
              </div>
            ))}
            {c.fromDeposit > 0 && <div>From deposit {fmt(c.fromDeposit)}</div>}
          </div>
        )}
      </span>
      <span className="r">
        <span className={`a num${dead || l.status === 'paid' ? ' strike' : ''}`}>{fmt(t.amount)}</span>
        <StatusPill row={l} />
      </span>
    </div>
  )
}
