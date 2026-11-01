// The slim card bar on Transactions and Payments (docs/intent/phase-1.md §2, prototype `cardBar()`): the selected
// card's palette dot, name and last 4 digits. Tapping it opens the card picker (a bottom-sheet list); a swipe of more
// than 50px (touch or mouse) or the arrow keys move to the next / previous card. The bar slides slightly in the
// direction of the change.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Sheet } from '../../components/Sheet'
import { paletteOf } from '../look/palettes'
import type { CardTile } from './CardCarousel'
import { keyTarget, swipeTarget } from './carousel'

export interface CardBarProps {
  tiles: readonly CardTile[]
  selectedId: string
  onSelect(id: string): void
}

const number = (t: CardTile) => (t.last4 ? `•••• ${t.last4}` : '')

export function CardBar({ tiles, selectedId, onSelect }: CardBarProps) {
  const index = Math.max(
    0,
    tiles.findIndex((t) => t.id === selectedId),
  )
  const current = tiles[index]
  const [open, setOpen] = useState(false)
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null)
  const swipe = useRef<{ x: number; id: number } | null>(null)
  const swiped = useRef(false)

  const go = (i: number) => {
    if (i === index || !tiles[i]) return
    setSlide(i > index ? 'next' : 'prev')
    onSelect(tiles[i].id)
  }

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    swipe.current = { x: e.clientX, id: e.pointerId }
    swiped.current = false
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = swipe.current
    swipe.current = null
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 6) swiped.current = true // a drag is never a tap
    go(swipeTarget(index, dx, tiles.length))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    go(keyTarget(e.key, index, tiles.length)!)
  }

  if (!current) return null
  return (
    <>
      <button
        type="button"
        className={`cbar${slide ? ` slide-${slide}` : ''}`}
        onAnimationEnd={() => setSlide(null)}
        aria-label={`Card: ${current.name}${current.last4 ? ` •••• ${current.last4}` : ''}`}
        aria-haspopup="listbox"
        aria-description={tiles.length > 1 ? 'Swipe or use the arrow keys to switch cards' : undefined}
        style={{ ['--c' as string]: paletteOf(current.palette).acc }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false
            return
          }
          setOpen(true)
        }}
      >
        <span className="cdot" aria-hidden="true" />
        <span className="cname">
          <b>{current.name}</b>
          {current.last4 && <span className="xs muted"> · {number(current)}</span>}
        </span>
        <span className="xs muted cmeta">{current.bank}</span>
      </button>
      {open && (
        <Sheet title="Card" onClose={() => setOpen(false)} layer="picker">
          <div role="listbox" aria-label="Card" className="opts">
            {tiles.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="option"
                className="opt"
                aria-selected={i === index}
                data-autofocus={i === index ? '' : undefined}
                onClick={() => {
                  setOpen(false)
                  go(i)
                }}
              >
                <span>
                  {t.name}
                  <span className="s">
                    {t.bank}
                    {t.last4 ? ` · ${number(t)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}
