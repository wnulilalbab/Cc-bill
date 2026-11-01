// Insights (preview; docs/intent/phase-1.md "Insights tab ships as a preview only"; prototype `viewInsights()`): card
// bar, statement picker, "Phase 2 preview" pill, and bars of what the selected statement adds up to per person, per
// kind and per merchant, plus the spend of the last statements. Every number comes from src/domain/insights.
// Categories are not stored yet (phase 2), so the prototype's "Spent by category" is "Spent by person" here.
import { useMemo, useState } from 'react'
import { Picker } from '../../components/Picker'
import { spendTrend, statementInsights, type Bar, type KindGroup } from '../../domain/insights/insights'
import type { OwnerRecord } from '../../data/cards'
import { loadLedger } from '../../data/repo'
import { CardBar } from '../cards/CardBar'
import { plainTiles } from '../cards/CardCarousel'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { ownerLook } from '../payments/PaymentsPage'
import { OwnerChip } from '../settings/SettingsPage'
import { rp } from '../settings/format'
import { TopBar } from '../shell/TopBar'
import { dayLabel, defaultStatementId, fmt, MONTHS, statementName, statementsForPicker } from '../transactions/view'

const KIND_LABEL: Record<KindGroup, string> = { purchases: 'Purchases', installments: 'Installments', feesInterest: 'Fees and interest', refunds: 'Refunds' }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const merchantName = (m: string) => m.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())

function BarRow({ label, bar, dim, sub }: { label: React.ReactNode; bar: Bar<string | null>; dim?: boolean; sub?: string }) {
  return (
    <div className="ins-row">
      <div className="row small">
        <span>{label}</span>
        <b className="num">{fmt(bar.amount)}</b>
      </div>
      <div className={`bar${dim ? ' dim' : ''}`} aria-hidden="true">
        <i style={{ width: `${bar.width}%` }} />
      </div>
      {sub && <div className="xs muted">{sub}</div>}
    </div>
  )
}

export function InsightsPage() {
  const { db } = useData()
  const { cards, selected, selectCard } = useAppearance()
  const cardId = selected?.card.id
  const loaded = useDbQuery(async () => (cardId ? { cardId, ledger: await loadLedger(db, cardId) } : null), [db, cardId])
  const ledger = loaded && loaded.cardId === cardId ? loaded.ledger : undefined
  const [stmtByCard, setStmtByCard] = useState<Record<string, string>>({})
  const owners: OwnerRecord[] = useMemo(() => selected?.owners ?? [], [selected])

  const chosen = cardId ? stmtByCard[cardId] : undefined
  const statementId = ledger && cardId ? (ledger.statements.some((s) => s.id === chosen) ? chosen : defaultStatementId(ledger, cardId)) : undefined
  const statement = ledger?.statements.find((s) => s.id === statementId)
  const insights = useMemo(() => (ledger && statementId ? statementInsights(ledger, statementId) : undefined), [ledger, statementId])
  const trend = useMemo(() => (ledger && cardId ? spendTrend(ledger, cardId, statementId) : []), [ledger, cardId, statementId])

  if (!cards) return <div className="screen small muted">Loading…</div>
  if (!selected || !cardId) {
    return (
      <div className="screen">
        <Header />
        <div className="box empty">Add a card in Settings first.</div>
      </div>
    )
  }

  return (
    <div className="screen">
      <Header />
      <CardBar tiles={plainTiles(cards)} selectedId={cardId} onSelect={selectCard} />
      <div className="row">
        {ledger && statementId ? (
          <Picker
            title="Statement"
            value={statementId}
            options={statementsForPicker(ledger.statements).map((s) => ({
              value: s.id,
              label: s.kind === 'unbilled' ? 'Unbilled' : statementName(s),
              sub: s.kind === 'unbilled' ? 'Not on a statement yet' : `Closed ${dayLabel(s.statementDate)} · due ${dayLabel(s.dueDate)}`,
            }))}
            onChange={(id) => setStmtByCard((m) => ({ ...m, [cardId]: id }))}
          />
        ) : (
          <span />
        )}
        <span className="pill warn">Phase 2 preview</span>
      </div>

      {!ledger ? (
        <div className="small muted">Loading…</div>
      ) : !statement || !insights ? (
        <div className="box empty">No statements on this card yet. Import one first.</div>
      ) : insights.rows === 0 ? (
        <div className="box empty">Nothing was spent on {statement.kind === 'unbilled' ? 'Unbilled' : `the ${statementName(statement)}`}.</div>
      ) : (
        <>
          <div className="box tight" aria-label="Spent">
            <div className="lbl">Spent{statement.kind === 'unbilled' ? ' in Unbilled' : ` on the ${statementName(statement)}`}</div>
            <div className="row">
              <b className="num" style={{ fontSize: 22 }}>
                {rp(insights.spent)}
              </b>
              <span className="xs muted">{plural(insights.rows, 'row')}</span>
            </div>
            {insights.refunds > 0 && (
              <div className="xs muted">
                Charges {fmt(insights.charges)} minus refunds {fmt(insights.refunds)}.
              </div>
            )}
            <div className="xs muted">Payments are not spending and are not counted here. Cancelled purchases and reversals count 0.</div>
          </div>

          <div className="box tight" aria-label="Spent by person">
            <div className="lbl">Spent by person</div>
            {insights.byOwner.map((b) => {
              const look = b.key === null ? { name: 'No owner', color: 'var(--muted)' } : ownerLook(owners, b.key)
              return <BarRow key={b.key ?? '_none'} label={<OwnerChip {...look} />} bar={b} sub={plural(b.rows, 'row')} />
            })}
          </div>

          <div className="box tight" aria-label="By kind">
            <div className="lbl">By kind</div>
            {insights.byKind.map((b) => (
              <BarRow key={b.key} label={KIND_LABEL[b.key]} bar={b} dim={b.key === 'refunds'} />
            ))}
          </div>

          {insights.topMerchants.length > 0 && (
            <div className="box tight" aria-label="Top merchants">
              <div className="lbl">Top merchants</div>
              {insights.topMerchants.map((b) => (
                <BarRow key={b.key} label={merchantName(b.key)} bar={b} sub={b.rows > 1 ? plural(b.rows, 'row') : undefined} />
              ))}
            </div>
          )}
        </>
      )}

      {trend.length > 1 && (
        <div className="box tight" aria-label="Last statements">
          <div className="lbl">Last statements</div>
          {trend.map((p) => (
            <BarRow
              key={p.statementId}
              label={`${MONTHS[Number(p.statementDate.slice(5, 7)) - 1]} ${p.statementDate.slice(0, 4)}${p.statementId === statementId ? ' (shown)' : ''}`}
              bar={{ key: p.statementId, amount: p.spent, rows: 0, width: p.width }}
              dim={p.statementId !== statementId}
            />
          ))}
        </div>
      )}

      <div className="note">Built in phase 2. Spending by category comes with it, once every row has a category from the import.</div>
    </div>
  )
}

function Header() {
  return <TopBar title="Insights" sub="Preview · built in phase 2" />
}
