// /v2/share: a small screen to reach the share sheet until the Bill screen (Slice 10) carries the Share buttons.
// Card and statement pickers, one row per person with what they must pay (ownerBill), "Share" on each row and
// "Share all".
import { useMemo, useState } from 'react'
import { Picker } from '../../components/Picker'
import { cardBill } from '../../domain/bill'
import type { ShareTarget } from '../../domain/share/message'
import type { OwnerRecord } from '../../data/cards'
import { loadLedger } from '../../data/repo'
import { useData } from '../data/DataContext'
import { localIsoDate } from '../data/today'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { rp } from '../settings/format'
import { dayLabel, defaultStatementId, statementName, statementsForPicker } from '../transactions/view'
import { ShareSheet } from './ShareSheet'

export function SharePage({ today = localIsoDate() }: { today?: string }) {
  const { db } = useData()
  const { cards, selected, selectCard } = useAppearance()
  const cardId = selected?.card.id
  const loaded = useDbQuery(async () => (cardId ? { cardId, ledger: await loadLedger(db, cardId) } : null), [db, cardId])
  const ledger = loaded && loaded.cardId === cardId ? loaded.ledger : undefined
  const [stmtByCard, setStmtByCard] = useState<Record<string, string>>({})
  const [sharing, setSharing] = useState<ShareTarget | null>(null)
  const owners: OwnerRecord[] = useMemo(() => selected?.owners ?? [], [selected])

  const chosen = cardId ? stmtByCard[cardId] : undefined
  const statementId = ledger && cardId && (ledger.statements.some((s) => s.id === chosen) ? chosen : defaultStatementId(ledger, cardId))
  const bill = useMemo(() => (ledger && statementId ? cardBill(ledger, owners.map((o) => o.id), statementId, today) : undefined), [ledger, owners, statementId, today])

  if (!cards) return <div className="screen small muted">Loading…</div>
  if (!selected || !cardId) {
    return (
      <div className="screen">
        <div className="top">
          <h1>Share</h1>
        </div>
        <div className="box empty">Add a card in Settings first.</div>
      </div>
    )
  }
  const nameOf = (id: string | null) => (id === null ? 'No owner' : (owners.find((o) => o.id === id)?.name ?? 'Unknown'))

  return (
    <div className="screen">
      <div className="top">
        <h1>Share</h1>
      </div>
      <Picker
        title="Card"
        value={cardId}
        options={cards.map((c) => ({ value: c.card.id, label: c.card.name, sub: c.card.bank }))}
        onChange={selectCard}
        field
      />
      {!ledger ? (
        <div className="small muted">Loading…</div>
      ) : !statementId || !bill ? (
        <div className="box empty">No statements on this card yet. Import one first.</div>
      ) : (
        <>
          <Picker
            title="Statement"
            value={statementId}
            options={statementsForPicker(ledger.statements).map((s) => ({
              value: s.id,
              label: s.kind === 'unbilled' ? 'Unbilled' : statementName(s),
              sub: s.kind === 'unbilled' ? 'Not on a statement yet' : `Due ${dayLabel(s.dueDate)}`,
            }))}
            onChange={(id) => setStmtByCard((m) => ({ ...m, [cardId]: id }))}
          />
          <div className="row">
            <span className="lbl">By person</span>
            <button type="button" className="link" onClick={() => setSharing('all')}>
              Share all
            </button>
          </div>
          <div className="box tight" aria-label="By person">
            {bill.owners.map((b) => (
              <div className="row small" key={b.ownerId ?? 'none'}>
                <span className="b">{nameOf(b.ownerId)}</span>
                <span className="num">{b.settled ? 'Paid ✓' : rp(b.mustPay)}</span>
                <button type="button" className="btn ghost sm" aria-label={`Share ${nameOf(b.ownerId)}'s bill`} onClick={() => setSharing({ ownerId: b.ownerId })}>
                  Share
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn acc" onClick={() => setSharing('all')}>
            Share to WhatsApp
          </button>
        </>
      )}
      {sharing && ledger && statementId && (
        <ShareSheet
          ledger={ledger}
          card={selected.card}
          owners={owners}
          statementId={statementId}
          initialTarget={sharing}
          today={today}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  )
}
