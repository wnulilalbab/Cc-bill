// Card switcher on Bill: one tile per card with the total of its selected statement (M-09), plus "+ Add card".
// Kept deliberately simple: Slice 12 wraps these tiles in the swipe carousel (1.586:1 cards, ~60% width, dots),
// so the tile and its props are the contract and the row layout is the part that gets replaced.
import { Link } from 'react-router-dom'
import { paletteOf } from '../look/palettes'
import { rp } from '../settings/format'

export interface CardTile {
  id: string
  name: string
  bank: string
  last4?: string
  palette?: string
  /** "Oct 2026 bill · due 28 Oct", "Open incl. unbilled" or "No statement yet". */
  caption: string
  /** Total of the selected statement (the owners' must-pay), or null when there is none. */
  total: number | null
}

export function CardSwitcher({ tiles, selectedId, onSelect }: { tiles: readonly CardTile[]; selectedId: string; onSelect(id: string): void }) {
  return (
    <div className="cards" role="group" aria-label="Cards">
      {tiles.map((t) => (
        <CardTileButton key={t.id} tile={t} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} />
      ))}
      <Link className="ccard add" to="/v2/settings">
        + Add card
      </Link>
    </div>
  )
}

export function CardTileButton({ tile, selected, onSelect }: { tile: CardTile; selected: boolean; onSelect(): void }) {
  const p = paletteOf(tile.palette)
  return (
    <button
      type="button"
      className="ccard"
      aria-pressed={selected}
      aria-label={`${tile.name}${tile.total !== null ? ` ${rp(tile.total)}` : ''}`}
      // The selected tile takes the palette's deep tone (via --tile, black in Bold); others show their own accent.
      style={{ ['--c' as string]: selected ? 'var(--tile)' : p.acc }}
      onClick={onSelect}
    >
      <span>
        <span className="nm">{tile.name}</span>
        <span className="bk">
          {tile.bank}
          {tile.last4 ? ` · •••• ${tile.last4}` : ''}
        </span>
      </span>
      <span>
        <span className="bk">{tile.caption}</span>
        <span className="amt num">{tile.total !== null ? rp(tile.total) : '—'}</span>
      </span>
    </button>
  )
}
