// The card carousel (docs/intent/phase-1.md §2, owner feedback): a banner slider of credit-card-sized tiles
// (1.586 : 1, about 60% of the width, max 240px), the selected card centred and its neighbours peeking. Touch swipes
// scroll natively with scroll-snap; a mouse drag of more than 50px moves one card; arrow keys, Home and End move the
// selection; tapping a peeking card selects it. The snapped card becomes the selected card once the row settles.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { paletteOf } from '../look/palettes'
import { rp } from '../settings/format'
import { keyTarget, scrollLeftFor, snapIndex, swipeTarget } from './carousel'

export interface CardTile {
  id: string
  name: string
  bank: string
  last4?: string
  palette?: string
  /** Line above the amount: "Oct 2026 bill · due 28 Oct", "Open incl. unbilled", "No statement yet". */
  caption?: string
  /**
   * Total of the selected statement (null: there is none, shown as "—"). Left out on screens that don't show
   * totals: the tile then shows the card number.
   */
  total?: number | null
}

/** Tiles for screens that only switch cards (no totals). */
export const plainTiles = (cards: readonly { card: { id: string; name: string; bank: string; last4?: string; palette?: string } }[]): CardTile[] =>
  cards.map(({ card: c }) => ({ id: c.id, name: c.name, bank: c.bank, last4: c.last4, palette: c.palette }))

/** Quiet time after the last scroll event before the snapped card is taken as selected (for browsers without `scrollend`). */
export const SETTLE_MS = 140

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export interface CardCarouselProps {
  tiles: readonly CardTile[]
  selectedId: string
  onSelect(id: string): void
  /** Adds a smaller "+ Add card" tile at the end, linking here. */
  addHref?: string
}

export function CardCarousel({ tiles, selectedId, onSelect, addHref }: CardCarouselProps) {
  const ref = useRef<HTMLDivElement>(null)
  const selected = Math.max(
    0,
    tiles.findIndex((t) => t.id === selectedId),
  )
  /** The card centred right now (follows the finger while swiping; equals `selected` at rest). */
  const [live, setLive] = useState(selected)
  const drag = useRef<{ x: number; left: number; start: number; moved: boolean; id: number } | null>(null)
  const suppressClick = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const first = useRef(true)
  const latest = useRef({ tiles, selected, onSelect })
  latest.current = { tiles, selected, onSelect }

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-card]') ?? [])
  const boxes = () => items().map((el) => ({ left: el.offsetLeft, width: el.offsetWidth }))

  const scrollTo = useCallback((i: number, smooth: boolean) => {
    const el = ref.current
    const box = boxes()[i]
    if (!el || !box) return
    const left = scrollLeftFor(box, el.clientWidth)
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
    else el.scrollLeft = left
  }, [])

  // Keep the selected card centred: on mount without animation, afterwards gliding to it.
  useEffect(() => {
    setLive(selected)
    scrollTo(selected, !first.current)
    first.current = false
  }, [selected, scrollTo])

  useEffect(() => {
    const recentre = () => scrollTo(latest.current.selected, false)
    window.addEventListener('resize', recentre)
    return () => window.removeEventListener('resize', recentre)
  }, [scrollTo])

  /** The row came to rest: the snapped card becomes the selected one. */
  const settle = useCallback(() => {
    clearTimeout(timer.current)
    const el = ref.current
    if (!el || drag.current) return
    const i = snapIndex(el.scrollLeft, el.clientWidth, boxes())
    const { tiles: t, selected: s, onSelect: pick } = latest.current
    if (i >= 0 && i !== s) pick(t[i].id)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scrollend', settle)
    return () => {
      el.removeEventListener('scrollend', settle)
      clearTimeout(timer.current)
    }
  }, [settle])

  const onScroll = () => {
    const el = ref.current!
    const i = snapIndex(el.scrollLeft, el.clientWidth, boxes())
    if (i >= 0) setLive(i)
    clearTimeout(timer.current)
    timer.current = setTimeout(settle, SETTLE_MS)
  }

  const choose = (i: number) => {
    if (i !== selected) onSelect(tiles[i].id)
    else scrollTo(i, true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = keyTarget(e.key, selected, tiles.length)
    if (i === null || !(e.target as HTMLElement).hasAttribute('data-card')) return
    e.preventDefault()
    items()[i]?.focus()
    choose(i)
  }

  // Mouse drag (touch scrolls natively). Snapping is off while dragging so the row follows the pointer.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = { x: e.clientX, left: ref.current!.scrollLeft, start: selected, moved: false, id: e.pointerId }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true
      ref.current!.classList.add('dragging')
      ref.current!.setPointerCapture?.(e.pointerId)
    }
    if (d.moved) ref.current!.scrollLeft = d.left - dx
  }
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.moved) return
    ref.current!.classList.remove('dragging')
    suppressClick.current = true
    choose(swipeTarget(d.start, e.clientX - d.x, tiles.length))
  }
  const onClickCapture = (e: MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  const current = tiles[selected]
  return (
    <>
      <div
        ref={ref}
        className="cards"
        role="group"
        aria-roledescription="carousel"
        aria-label="Cards"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {tiles.map((t, i) => (
          <Tile key={t.id} tile={t} index={i} count={tiles.length} selected={i === selected} centred={i === live} onClick={() => choose(i)} />
        ))}
        {addHref && (
          <Link className="ccard add" to={addHref}>
            + Add card
          </Link>
        )}
      </div>
      {tiles.length > 1 && (
        <div className="dots" aria-hidden="true">
          {tiles.map((t, i) => (
            <i key={t.id} className={i === live ? 'on' : undefined} />
          ))}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {current && tiles.length > 1 ? `${current.name} selected, card ${selected + 1} of ${tiles.length}` : ''}
      </div>
    </>
  )
}

function cardNumber(t: CardTile) {
  return t.last4 ? `•••• ${t.last4}` : ''
}

function Tile({ tile: t, index, count, selected, centred, onClick }: { tile: CardTile; index: number; count: number; selected: boolean; centred: boolean; onClick(): void }) {
  const p = paletteOf(t.palette)
  const withTotal = t.total !== undefined
  const descId = `ccard-${t.id}`
  return (
    <button
      type="button"
      data-card=""
      className={`ccard${centred ? ' on' : ''}`}
      aria-pressed={selected}
      aria-label={`${t.name}${typeof t.total === 'number' ? ` ${rp(t.total)}` : ''}`}
      aria-describedby={descId}
      aria-roledescription="card"
      tabIndex={selected ? 0 : -1}
      // Each tile in its own palette: the accent orb, and the deep tone when centred. The selected card takes the app's
      // --tile token (its deep tone, black in Bold), which the Bill "To pay" box never repeats (U-08).
      style={{ ['--c' as string]: p.acc, ['--fill' as string]: selected ? 'var(--tile)' : p.deep }}
      onClick={onClick}
    >
      <span className="orb" aria-hidden="true" />
      <span id={descId}>
        <span className="nm">{t.name}</span>
        <span className="bk">
          {t.bank}
          {t.last4 ? ` · ${cardNumber(t)}` : ''}
          <span className="sr-only">{`, card ${index + 1} of ${count}`}</span>
        </span>
      </span>
      <span>
        {t.caption && <span className="bk">{t.caption}</span>}
        <span className="amt num">{withTotal ? (t.total === null ? '—' : rp(t.total!)) : cardNumber(t) || t.bank}</span>
      </span>
    </button>
  )
}
