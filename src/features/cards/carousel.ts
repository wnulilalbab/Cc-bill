// The card carousel's arithmetic, kept apart from the DOM so it can be tested without a layout engine.

/** Index of the item whose centre is closest to `centre` (ties go to the first). -1 when there are no items. */
export function nearestIndex(centre: number, centres: readonly number[]): number {
  let best = -1
  let gap = Infinity
  centres.forEach((c, i) => {
    const d = Math.abs(c - centre)
    if (d < gap) {
      gap = d
      best = i
    }
  })
  return best
}

/** The snapped card for a scroll position: the one centred in the viewport. */
export function snapIndex(scrollLeft: number, viewportWidth: number, items: readonly { left: number; width: number }[]): number {
  return nearestIndex(
    scrollLeft + viewportWidth / 2,
    items.map((it) => it.left + it.width / 2),
  )
}

/** The scroll position that centres an item in the viewport (never negative). */
export function scrollLeftFor(item: { left: number; width: number }, viewportWidth: number): number {
  return Math.max(0, item.left + item.width / 2 - viewportWidth / 2)
}

/** Where a key press moves the selection: arrows step by one (stopping at the ends), Home and End jump. null for other keys. */
export function keyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, count - 1)
    case 'ArrowLeft':
      return Math.max(index - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** Minimum drag (px) that moves to the next card; a smaller drag snaps back. */
export const SWIPE_PX = 50

/** Where a mouse drag of `dx` px (negative = to the left) from card `start` lands: one card per swipe, clamped. */
export function swipeTarget(start: number, dx: number, count: number, threshold = SWIPE_PX): number {
  if (dx <= -threshold) return Math.min(start + 1, count - 1)
  if (dx >= threshold) return Math.max(start - 1, 0)
  return start
}
