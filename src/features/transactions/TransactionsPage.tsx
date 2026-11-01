// Transactions (docs/intent/phase-1.md §6; layout and wording from the prototype): card and statement pickers,
// search, filters, rows grouped by day with owner / Check / status, totals for what is shown, Draft/Final with jump
// links, the row sheet, bulk "Set owner" / "Mark reviewed", and "+ Add a missing transaction".
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Picker } from '../../components/Picker'
import { useToast } from '../../components/Toast'
import { computeMoney, unassignedOf } from '../../domain/amounts'
import { draftIssues, type DraftIssues } from '../../domain/draft'
import { reconcileStatement } from '../../domain/reconcile'
import type { Ledger, Payment } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import { loadLedger } from '../../data/repo'
import { markReviewed } from '../../data/transactions'
import { useData } from '../data/DataContext'
import { localIsoDate } from '../data/today'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { ownerColor } from '../look/palettes'
import { OwnerChip } from '../settings/SettingsPage'
import { rp } from '../settings/format'
import { TagSheet } from '../tagging/TagSheet'
import { AddRowSheet } from './AddRowSheet'
import { BulkOwnerSheet } from './BulkOwnerSheet'
import { RowSheet, StatusPill } from './RowSheet'
import {
  applyFilters,
  dayHeading,
  dayLabel,
  defaultStatementId,
  fmt,
  groupByDate,
  KIND_OPTIONS,
  MONTHS,
  NO_FILTERS,
  rowViews,
  statementName,
  statementsForPicker,
  STATUS_OPTIONS,
  TAG_SOURCE_LABEL,
  totalsOf,
  type Filters,
  type KindFilter,
  type RowView,
  type StatusFilter,
} from './view'

type Open = { kind: 'row'; id: string } | { kind: 'tag'; id: string; ownerId: string } | { kind: 'bulk' } | { kind: 'add' } | null

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const today = () => localIsoDate()

export function TransactionsPage() {
  const { db } = useData()
  const toast = useToast()
  const { cards, selected, selectCard } = useAppearance()
  const cardId = selected?.card.id
  const loaded = useDbQuery(async () => (cardId ? { cardId, ledger: await loadLedger(db, cardId) } : null), [db, cardId])
  const ledger = loaded && loaded.cardId === cardId ? loaded.ledger : undefined
  // Jump links from Bill: ?statement=<id>, ?status=check, ?row=<txId> (opens that row's sheet).
  const [params] = useSearchParams()
  const [stmtByCard, setStmtByCard] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<Filters>(() => {
    const status = params.get('status')
    return STATUS_OPTIONS.some((o) => o.value === status) ? { ...NO_FILTERS, status: status as StatusFilter } : NO_FILTERS
  })
  const [open, setOpen] = useState<Open>(() => (params.get('row') ? { kind: 'row', id: params.get('row')! } : null))
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reviewing, setReviewing] = useState(false)

  const owners: OwnerRecord[] = useMemo(() => selected?.owners ?? [], [selected])
  const ownerName = (id: string | null) => (id ? (owners.find((o) => o.id === id)?.name ?? 'Unknown') : '')
  const state = useMemo(() => (ledger ? computeMoney(ledger) : undefined), [ledger])
  const chosen = cardId ? (stmtByCard[cardId] ?? params.get('statement') ?? undefined) : undefined
  const statementId = ledger && (ledger.statements.some((s) => s.id === chosen) ? chosen : defaultStatementId(ledger, cardId!))
  const statement = ledger?.statements.find((s) => s.id === statementId)
  const all = useMemo(() => (ledger && statementId && state ? rowViews(ledger, statementId, state) : []), [ledger, statementId, state])
  const shown = applyFilters(all, filters, ownerName)
  const totals = totalsOf(shown)

  if (!cards) return <div className="screen small muted">Loading…</div>
  if (!selected || !cardId) {
    return (
      <div className="screen">
        <Header />
        <div className="box empty">Add a card in Settings first.</div>
      </div>
    )
  }

  const setFilter = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const findRow = (id: string): RowView | undefined => {
    const tx = ledger?.transactions.find((t) => t.id === id)
    return tx && ledger && state ? rowViews(ledger, tx.statementId, state).find((r) => r.tx.id === id) : undefined
  }
  const togglePick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const endSelect = () => {
    setSelecting(false)
    setPicked(new Set())
  }

  const ownerOptions = [
    { value: 'all', label: 'All owners' },
    ...owners.map((o) => ({ value: o.id, label: o.name, ...(o.archived && { sub: 'Archived' }) })),
    ...(all.some((r) => r.tx.ownerId === null) ? [{ value: 'none', label: 'No owner' }] : []),
  ]

  return (
    <div className="screen">
      <Header>
        <button type="button" className="btn ghost sm" aria-pressed={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
          {selecting ? 'Done' : 'Select'}
        </button>
      </Header>

      <Picker
        title="Card"
        value={cardId}
        options={cards.map((c) => ({ value: c.card.id, label: c.card.name, sub: `${c.card.bank}${c.card.last4 ? ` •••• ${c.card.last4}` : ''}` }))}
        onChange={(id) => {
          selectCard(id)
          setFilters(NO_FILTERS)
          endSelect()
        }}
        field
      />

      <input
        className="inp"
        type="search"
        aria-label="Search transactions"
        placeholder="Search description, label or amount"
        value={filters.q}
        onChange={(e) => setFilter({ q: e.target.value })}
      />
      <div className="filters">
        {ledger && statementId && (
          <Picker
            title="Statement"
            value={statementId}
            options={statementsForPicker(ledger.statements).map((s) => ({
              value: s.id,
              label: s.kind === 'unbilled' ? 'Unbilled' : statementName(s),
              sub: s.kind === 'unbilled' ? 'Not on a statement yet' : `Closed ${dayLabel(s.statementDate)} · due ${dayLabel(s.dueDate)}`,
            }))}
            onChange={(id) => {
              setStmtByCard((m) => ({ ...m, [cardId]: id }))
              endSelect()
            }}
          />
        )}
        <Picker title="Owner" value={filters.owner} options={ownerOptions} onChange={(owner) => setFilter({ owner })} />
        <Picker title="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => setFilter({ status: v as StatusFilter })} />
        <Picker title="Kind" value={filters.kind} options={KIND_OPTIONS} onChange={(v) => setFilter({ kind: v as KindFilter })} />
      </div>

      {!ledger ? (
        <div className="small muted">Loading…</div>
      ) : !statement ? (
        <div className="box empty">No statements on this card yet. Import one first.</div>
      ) : (
        <>
          <DraftPanel
            ledger={ledger}
            statementId={statement.id}
            onCheckRows={() => setFilters({ ...NO_FILTERS, status: 'check' })}
            onRow={(id) => setOpen({ kind: 'row', id })}
          />
          {statement.kind === 'billed' && <TotalsCheck ledger={ledger} statementId={statement.id} />}
          <div className="summary" aria-label="Totals">
            <div>
              <b className="num">{fmt(totals.total)}</b>
              <span>Total</span>
            </div>
            <div>
              <b className="num" style={{ color: 'var(--ok)' }}>
                {fmt(totals.paid)}
              </b>
              <span>Paid</span>
            </div>
            <div>
              <b className="num">{fmt(totals.left)}</b>
              <span>Left to pay</span>
            </div>
          </div>
          <div className="xs muted" aria-live="polite">
            {plural(shown.length, 'row')}
            {shown.length !== all.length ? ` of ${all.length}` : ''}
          </div>

          {shown.length ? (
            groupByDate(shown).map((g) => (
              <section key={g.date} aria-label={dayHeading(g.date)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="lbl">{dayHeading(g.date)}</div>
                <div className="txlist">
                  {g.rows.map((r) => (
                    <TxRow
                      key={r.tx.id}
                      row={r}
                      owners={owners}
                      selecting={selecting}
                      picked={picked.has(r.tx.id)}
                      onClick={() => (selecting ? togglePick(r.tx.id) : setOpen({ kind: 'row', id: r.tx.id }))}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="box empty">No transactions match these filters.</div>
          )}

          {!selecting && (
            <button type="button" className="btn ghost" onClick={() => setOpen({ kind: 'add' })}>
              + Add a missing transaction
            </button>
          )}
        </>
      )}

      {selecting && (
        <div className="bulkbar" role="toolbar" aria-label="Selected rows">
          <span className="small b">{plural(picked.size, 'row')} selected</span>
          <button type="button" className="btn ghost" onClick={() => setPicked(new Set(shown.map((r) => r.tx.id)))}>
            Select all shown
          </button>
          <button type="button" className="btn acc" disabled={!picked.size} onClick={() => setOpen({ kind: 'bulk' })}>
            Set owner
          </button>
          <button
            type="button"
            className="btn acc"
            disabled={!picked.size || reviewing}
            onClick={async () => {
              if (reviewing) return
              setReviewing(true)
              try {
                const n = await markReviewed(db, [...picked])
                toast(n ? `${plural(n, 'row')} marked reviewed` : 'Already reviewed')
                endSelect()
              } catch (e) {
                toast(`Could not mark reviewed: ${e instanceof Error ? e.message : String(e)}`)
              } finally {
                setReviewing(false)
              }
            }}
          >
            Mark reviewed
          </button>
        </div>
      )}

      {open?.kind === 'row' && ledger && (() => {
        const row = findRow(open.id)
        if (!row) return null
        return (
          <RowSheet
            key={`${row.tx.id}:${row.tx.ownerId}:${row.tx.amount}:${row.tx.date}`}
            row={row}
            ledger={ledger}
            owners={owners}
            onClose={() => setOpen(null)}
            onPickOwner={(ownerId) => setOpen({ kind: 'tag', id: row.tx.id, ownerId })}
          />
        )
      })()}
      {open?.kind === 'tag' && (() => {
        const row = findRow(open.id)
        if (!row) return null
        return (
          <TagSheet
            tx={row.tx}
            cardName={selected.card.name}
            owners={owners}
            initialOwnerId={open.ownerId}
            onClose={() => setOpen({ kind: 'row', id: open.id })}
            onSaved={() => setOpen(null)}
          />
        )
      })()}
      {open?.kind === 'bulk' && (
        <BulkOwnerSheet
          txIds={[...picked]}
          owners={owners}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            endSelect()
          }}
        />
      )}
      {open?.kind === 'add' && statement && (
        <AddRowSheet
          statement={statement}
          owners={owners}
          defaultOwnerId={selected.card.defaultOwnerId}
          date={statement.kind === 'billed' ? statement.statementDate : today()}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <>
      <div className="top">
        <h1>Transactions</h1>
        {children}
      </div>
      <Link className="note" to="/transactions">
        Old transactions screen
      </Link>
    </>
  )
}

function TxRow({ row, owners, selecting, picked, onClick }: { row: RowView; owners: readonly OwnerRecord[]; selecting: boolean; picked: boolean; onClick(): void }) {
  const t = row.tx
  const i = owners.findIndex((o) => o.id === t.ownerId)
  const owner = owners[i]
  const dead = row.status === 'notCounted'
  const strike = dead || row.status === 'paid'
  return (
    <button type="button" className={`tx${t.check ? ' check' : ''}`} aria-pressed={selecting ? picked : undefined} aria-label={`${t.label ?? t.description} ${fmt(t.amount)}`} onClick={onClick}>
      <span className="date">
        <b>{Number(t.date.slice(8, 10))}</b>
        <span>{MONTHS[Number(t.date.slice(5, 7)) - 1]}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="ttl">
          {selecting && <span aria-hidden="true">{picked ? '☑ ' : '☐ '}</span>}
          {t.label ?? t.description}
        </div>
        {t.label && <div className="raw">{t.description}</div>}
        <div className="tags">
          {owner ? <OwnerChip name={owner.name} color={owner.color ?? ownerColor(i)} archived={owner.archived} /> : <span className="pill">No owner</span>}
          {t.installment && <span className="pill acc">Installment {t.installment.n}/{t.installment.of}</span>}
          {t.kind === 'fee' && <span className="pill">Fee</span>}
          {t.kind === 'interest' && <span className="pill">Interest</span>}
          {t.kind === 'reversal' && <span className="pill acc">Reversal</span>}
          {t.cancelled && <span className="pill acc">Moved to installment</span>}
          {row.notOnStatement && <span className="pill bad">Not on {row.notOnStatement} statement</span>}
          {t.check ? <span className="pill warn">● Check</span> : t.tagSource && <span className="pill">{TAG_SOURCE_LABEL[t.tagSource]}</span>}
          {row.sameDay && (
            <span className="pill">
              {row.sameDay.n} of {row.sameDay.of} same day
            </span>
          )}
        </div>
      </span>
      <span className="r">
        <span className={`a num${strike ? ' strike' : ''}`}>{fmt(t.amount)}</span>
        <StatusPill row={row} />
      </span>
    </button>
  )
}

const payText = (p: Payment) => `${dayLabel(p.date)} · ${p.description ?? (p.source === 'manual' ? 'Recorded by you' : 'Bank payment')} · ${rp(p.amount)}`

/** Draft vs Final for the selected statement (domain draftIssues), each issue with its jump link. */
function DraftPanel({ ledger, statementId, onCheckRows, onRow }: { ledger: Ledger; statementId: string; onCheckRows(): void; onRow(id: string): void }) {
  const issues: DraftIssues = draftIssues(ledger, statementId)
  if (issues.final) {
    return (
      <div className="status final" aria-label="Draft or Final">
        <h3>Final ✓</h3>
        <div className="xs">Nothing left to check on this statement.</div>
      </div>
    )
  }
  const tx = (id: string) => ledger.transactions.find((t) => t.id === id)!
  const pay = (id: string) => ledger.payments.find((p) => p.id === id)!
  const rowLink = (id: string, why: string) => (
    <li key={`${why}-${id}`}>
      <button type="button" className="link" onClick={() => onRow(id)}>
        {why}: {tx(id).description} {fmt(tx(id).amount)}
      </button>
    </li>
  )
  const payItem = (id: string, why: string) => (
    <li key={`${why}-${id}`}>
      <Link className="link xs" to={`/v2/payments/${encodeURIComponent(id)}`}>
        {why}: {payText(pay(id))}
        {why === 'Not fully assigned' && ` (${rp(unassignedOf(pay(id)))} left)`}
      </Link>
    </li>
  )
  return (
    <div className="status draft" aria-label="Draft or Final">
      <h3>Draft · {plural(issues.count, 'thing')} to resolve</h3>
      <ul className="issues">
        {issues.checkRows.length > 0 && (
          <li>
            <button type="button" className="link" onClick={onCheckRows}>
              {issues.checkRows.length === 1 ? '1 row needs a check' : `${issues.checkRows.length} rows need a check`}
            </button>
          </li>
        )}
        {issues.wrongSignRows.map((id) => rowLink(id, 'Sign looks wrong'))}
        {issues.blockingPayments.map((id) => payItem(id, 'Not fully assigned'))}
        {issues.missingPayments.map((id) => payItem(id, "Isn't on a statement"))}
        {issues.possibleDuplicatePayments.map((id) => payItem(id, 'May be the same money as a bank line'))}
        {issues.notOnStatementRows.map((id) => rowLink(id, 'Not on this statement'))}
        {issues.notOnStatementPayments.map((id) => payItem(id, 'Unbilled payment not on this statement'))}
      </ul>
      {issues.blockingPayments.length + issues.missingPayments.length + issues.possibleDuplicatePayments.length + issues.notOnStatementPayments.length > 0 && (
        <div className="xs muted">
          Tap a payment to assign or resolve it, or open <Link to="/v2/payments">Payments</Link>.
        </div>
      )}
    </div>
  )
}

function TotalsCheck({ ledger, statementId }: { ledger: Ledger; statementId: string }) {
  const r = reconcileStatement(ledger, statementId)
  return r.ok ? (
    <div className="xs muted" aria-label="Totals check">
      Totals check: matches the statement ✓
    </div>
  ) : (
    <div className="err" aria-label="Totals check">
      Totals check: off by {rp(r.difference)}. Fix or add rows until it matches.
    </div>
  )
}
