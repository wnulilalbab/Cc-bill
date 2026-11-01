// Data for the Bill screens: every card's ledger (tiles show each card's total), the selected card and the selected
// statement (`?s=` in the URL, so the person detail and the back button keep it).
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CardWithOwners } from '../../data/cards'
import { loadLedger } from '../../data/repo'
import type { Ledger, Statement } from '../../domain/types'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { useAppearance } from '../look/Appearance'
import { defaultStatementId } from '../transactions/view'

export const todayIso = () => new Date().toISOString().slice(0, 10)

export interface BillData {
  cards: CardWithOwners[] | undefined
  selected: CardWithOwners | undefined
  selectCard(id: string): void
  /** cardId → ledger; undefined while loading. */
  ledgers: Record<string, Ledger> | undefined
  ledger: Ledger | undefined
  statement: Statement | undefined
  /** Picks a statement of the selected card (kept in the URL). */
  setStatement(id: string): void
}

/** The statement a card's tile and bill show: the chosen one when it belongs to the card, else the latest billed. */
export function statementFor(ledger: Ledger, cardId: string, chosen: string | null): Statement | undefined {
  const id = ledger.statements.some((s) => s.id === chosen) ? chosen : defaultStatementId(ledger, cardId)
  return ledger.statements.find((s) => s.id === id)
}

export function useBill(): BillData {
  const { db } = useData()
  const { cards, selected, selectCard } = useAppearance()
  const [params, setParams] = useSearchParams()
  const ids = cards?.map((c) => c.card.id).join('|')
  const loaded = useDbQuery(
    async () => (cards ? { ids, ledgers: Object.fromEntries(await Promise.all(cards.map(async (c) => [c.card.id, await loadLedger(db, c.card.id)] as const))) } : null),
    [db, ids],
  )
  const ledgers = loaded && loaded.ids === ids ? loaded.ledgers : undefined
  // A link to another card's statement (e.g. a person detail) selects that card.
  const chosen = params.get('s')
  const owning = ledgers && chosen ? Object.entries(ledgers).find(([, l]) => l.statements.some((s) => s.id === chosen))?.[0] : undefined
  useEffect(() => {
    if (owning && owning !== selected?.card.id) selectCard(owning)
  }, [owning, selected?.card.id, selectCard])
  // Until that card is selected, nothing is shown (no flash of "not on this card").
  const ledger = selected && ledgers && (!owning || owning === selected.card.id) ? ledgers[selected.card.id] : undefined
  const statement = ledger && selected ? statementFor(ledger, selected.card.id, chosen) : undefined
  return {
    cards,
    selected,
    selectCard: (id) => {
      selectCard(id)
      setParams({}, { replace: true })
    },
    ledgers,
    ledger,
    statement,
    setStatement: (id) => setParams({ s: id }, { replace: true }),
  }
}
