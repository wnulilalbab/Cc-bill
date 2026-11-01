// Add / edit card: name, bank, last 4, statement day, palette, its own owners, default owner. Delete when unused.
import { useState } from 'react'
import { CardError, deleteCard, draftProblem, saveCard, type CardDraft, type CardWithOwners } from '../../data/cards'
import { Picker } from '../../components/Picker'
import { Sheet } from '../../components/Sheet'
import { useData } from '../data/DataContext'
import { ownerColor, OWNER_COLORS, PALETTES, paletteOf } from '../look/palettes'

export const BANKS = ['BCA', 'Mandiri', 'BNI', 'BRI', 'CIMB', 'Other'] as const

export function draftOf(c: CardWithOwners | null): CardDraft {
  if (!c) return { name: '', bank: 'BNI', last4: '', statementDay: '', palette: 'green', owners: [{ name: 'Me', color: ownerColor(0) }], defaultIndex: 0 }
  return {
    id: c.card.id,
    name: c.card.name,
    bank: c.card.bank,
    last4: c.card.last4 ?? '',
    statementDay: c.card.statementDay ? String(c.card.statementDay) : '',
    palette: paletteOf(c.card.palette).id,
    owners: c.owners.map((o, i) => ({ id: o.id, name: o.name, color: o.color ?? ownerColor(i), ...(o.archived && { archived: true }) })),
    defaultIndex: c.owners.findIndex((o) => o.id === c.card.defaultOwnerId),
  }
}

export interface CardSheetProps {
  card: CardWithOwners | null
  /** Owner ids with history (rows, plans or payments): only Archive is offered for them. */
  history: ReadonlySet<string>
  /** The card holds transactions, payments or plans, so it cannot be deleted. */
  cardInUse: boolean
  onClose(): void
  onSaved(cardId: string): void
  onDeleted(cardId: string): void
}

export function CardSheet({ card, history, cardInUse, onClose, onSaved, onDeleted }: CardSheetProps) {
  const { db } = useData()
  const [d, setD] = useState<CardDraft>(() => draftOf(card))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const patch = (p: Partial<CardDraft>) => setD((x) => ({ ...x, ...p }))
  const patchOwner = (i: number, p: Partial<CardDraft['owners'][number]>) =>
    setD((x) => ({ ...x, owners: x.owners.map((o, j) => (j === i ? { ...o, ...p } : o)) }))

  const removeOwner = (i: number) =>
    setD((x) => ({
      ...x,
      owners: x.owners.filter((_, j) => j !== i),
      defaultIndex: x.defaultIndex === i ? -1 : x.defaultIndex > i ? x.defaultIndex - 1 : x.defaultIndex,
    }))

  const toggleArchive = (i: number) =>
    setD((x) => {
      const archived = !x.owners[i].archived
      return { ...x, owners: x.owners.map((o, j) => (j === i ? { ...o, archived } : o)), defaultIndex: archived && x.defaultIndex === i ? -1 : x.defaultIndex }
    })

  const nextColor = (c: string) => OWNER_COLORS[(OWNER_COLORS.indexOf(c as (typeof OWNER_COLORS)[number]) + 1) % OWNER_COLORS.length]

  async function save() {
    const problem = draftProblem(d)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      onSaved(await saveCard(db, d))
    } catch (e) {
      setError(e instanceof CardError ? e.message : `Could not save the card: ${String(e)}`)
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteCard(db, card!.card.id)
      onDeleted(card!.card.id)
    } catch (e) {
      setError(e instanceof CardError ? e.message : `Could not delete the card: ${String(e)}`)
      setConfirmDelete(false)
      setBusy(false)
    }
  }

  const defaultOptions = [
    { value: '-1', label: 'None', sub: 'Rows with no rule or history are marked "check"' },
    ...d.owners.flatMap((o, i) => (o.archived ? [] : [{ value: String(i), label: o.name || 'Unnamed owner' }])),
  ]

  return (
    <Sheet title={card ? 'Edit card' : 'Add card'} onClose={onClose}>
      <div className="field">
        <label htmlFor="cName">Name</label>
        <input className="inp" id="cName" value={d.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>
      <div className="btns">
        <div className="field">
          <span className="fl">Bank</span>
          <Picker title="Bank" field value={d.bank} options={BANKS.map((b) => ({ value: b, label: b }))} onChange={(bank) => patch({ bank })} />
        </div>
        <div className="field">
          <label htmlFor="cLast">Last 4 digits</label>
          <input className="inp" id="cLast" inputMode="numeric" maxLength={4} value={d.last4} onChange={(e) => patch({ last4: e.target.value.replace(/\D/g, '') })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cDay">Statement day</label>
        <input className="inp" id="cDay" inputMode="numeric" maxLength={2} placeholder="Day of the month the bank closes the statement" value={d.statementDay} onChange={(e) => patch({ statementDay: e.target.value.replace(/\D/g, '') })} />
      </div>
      <div className="field">
        <span className="fl">Palette (highlight + background)</span>
        <div className="pals">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" className="pal" aria-pressed={d.palette === p.id} onClick={() => patch({ palette: p.id })}>
              <span style={{ background: `linear-gradient(135deg,${p.bg} 0 50%,${p.deep} 50%)`, ['--a' as string]: p.acc }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="fl">Owners on this card only</span>
        {d.owners.map((o, i) => (
          <div className="row" key={o.id ?? `new-${i}`}>
            <button type="button" className="dot" aria-label={`Change colour of ${o.name || 'owner'}`} style={{ background: o.color }} onClick={() => patchOwner(i, { color: nextColor(o.color) })} />
            <input className={`inp${o.archived ? ' archived' : ''}`} aria-label="Owner name" value={o.name} onChange={(e) => patchOwner(i, { name: e.target.value })} />
            {o.id && history.has(o.id) ? (
              <button type="button" className="link" onClick={() => toggleArchive(i)}>
                {o.archived ? 'Restore' : 'Archive'}
              </button>
            ) : (
              <button type="button" className="link" onClick={() => removeOwner(i)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="xs muted">Archived owners keep their history but don&apos;t appear when tagging or assigning.</div>
        <button type="button" className="btn ghost sm" onClick={() => setD((x) => ({ ...x, owners: [...x.owners, { name: 'New owner', color: ownerColor(x.owners.length) }] }))}>
          + Add owner
        </button>
      </div>
      <div className="field">
        <span className="fl">Default owner (when no rule or history matches)</span>
        <Picker title="Default owner" field value={String(d.defaultIndex)} options={defaultOptions} onChange={(v) => patch({ defaultIndex: Number(v) })} />
      </div>
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn acc" disabled={busy} onClick={save}>
          Save card
        </button>
      </div>
      {card &&
        (cardInUse ? (
          <div className="xs muted">This card has transactions or payments, so it can&apos;t be deleted.</div>
        ) : confirmDelete ? (
          <div className="status draft">
            <div className="small">
              <b>Delete {card.card.name}?</b> Its owners and its empty Unbilled go too.
            </div>
            <div className="btns">
              <button type="button" className="btn ghost sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button type="button" className="btn danger sm" disabled={busy} onClick={remove}>
                Delete card
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn danger sm" onClick={() => setConfirmDelete(true)}>
            Delete card
          </button>
        ))}
    </Sheet>
  )
}
