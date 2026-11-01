// Settings (opened by the gear): cards and their owners, look, data and migration, AI, testing tools.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cardHasHistory, ownersWithHistory, type CardWithOwners } from '../../data/cards'
import { useToast } from '../../components/Toast'
import { useData } from '../data/DataContext'
import { useAppearance } from '../look/Appearance'
import { LOOKS, ownerColor, paletteOf } from '../look/palettes'
import { PATHS } from '../shell/paths'
import { TopBar } from '../shell/TopBar'
import { AiSection } from './AiSection'
import { CardSheet } from './CardSheet'
import { DataSection } from './DataSection'
import { TestingSection } from './TestingSection'

interface CardSheetState {
  card: CardWithOwners | null
  history: Set<string>
  inUse: boolean
}

const LOOK_PREVIEW: Record<string, [string, string]> = {
  clean: ['var(--pbg)', 'var(--acc-soft)'],
  soft: ['var(--pbg)', '#ffffff'],
  bold: ['#f3f3f3', 'var(--acc)'],
}

export function OwnerChip({ name, color, archived }: { name: string; color: string; archived?: boolean }) {
  return (
    <span className={`owner${archived ? ' archived' : ''}`} style={{ ['--oc' as string]: color }}>
      <i />
      {name}
    </span>
  )
}

export function SettingsPage() {
  const { db } = useData()
  const toast = useToast()
  const { cards, selectCard, look, setLook, selected } = useAppearance()
  const [sheet, setSheet] = useState<CardSheetState | null>(null)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  async function openCard(card: CardWithOwners | null) {
    if (!card) return setSheet({ card: null, history: new Set(), inUse: false })
    const [history, inUse] = await Promise.all([ownersWithHistory(db, card.card.id), cardHasHistory(db, card.card.id)])
    setSheet({ card, history, inUse })
  }

  return (
    <div className="screen">
      <TopBar title="Settings" backTo={PATHS.bill} gear={false} />

      <div className="lbl">Cards</div>
      {cards === undefined ? (
        <div className="small muted">Loading…</div>
      ) : cards.length === 0 ? (
        <div className="box empty small">No cards yet. Add one, or migrate your old data below.</div>
      ) : (
        cards.map((c) => {
          const p = paletteOf(c.card.palette)
          const def = c.owners.find((o) => o.id === c.card.defaultOwnerId)
          return (
            <button key={c.card.id} type="button" className="orow" aria-label={`Edit ${c.card.name}`} aria-current={selected?.card.id === c.card.id ? 'true' : undefined} onClick={() => openCard(c)}>
              <div className="row">
                <span className="b">{c.card.name}</span>
                <span className="pill" style={{ background: p.soft, color: '#111318' }}>
                  {p.name}
                </span>
              </div>
              <div className="xs muted">
                {c.card.bank}
                {c.card.last4 && ` •••• ${c.card.last4}`} · default owner: {def?.name ?? 'none'}
              </div>
              <div className="chips">
                {c.owners.map((o, i) => (
                  <OwnerChip key={o.id} name={o.name} color={o.color ?? ownerColor(i)} archived={o.archived} />
                ))}
              </div>
            </button>
          )
        })
      )}
      <button type="button" className="btn ghost" onClick={() => openCard(null)}>
        + Add card
      </button>
      {!!cards?.length && (
        <Link to={PATHS.rules} className="btn ghost">
          Tagging rules
        </Link>
      )}

      <div className="lbl">Look</div>
      <div className="skin">
        {LOOKS.map((l) => (
          <button key={l.id} type="button" aria-pressed={look === l.id} onClick={() => setLook(l.id)}>
            <span className="pv" style={{ background: LOOK_PREVIEW[l.id][0] }}>
              <span style={{ height: 18, borderRadius: 6, background: LOOK_PREVIEW[l.id][1] }} />
              <span style={{ height: 6, width: '60%', borderRadius: 3, background: 'var(--acc)' }} />
            </span>
            {l.name}
          </button>
        ))}
      </div>
      <div className="note">Colours always come from the selected card&apos;s palette.</div>

      <DataSection version={version} onChanged={bump} />
      <AiSection />
      <TestingSection onChanged={bump} />

      {sheet && (
        <CardSheet
          card={sheet.card}
          history={sheet.history}
          cardInUse={sheet.inUse}
          onClose={() => setSheet(null)}
          onSaved={(id) => {
            selectCard(id)
            setSheet(null)
            toast('Card saved')
          }}
          onDeleted={() => {
            setSheet(null)
            toast('Card deleted')
          }}
        />
      )}
    </div>
  )
}
