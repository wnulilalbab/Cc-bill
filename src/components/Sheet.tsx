// Bottom sheet: an overlay plus a panel sliding up from the bottom. Tapping the overlay or Escape closes it
// (unless `locked`). Focus moves into the sheet on open, Tab stays inside it, and focus returns to the trigger on close.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

export interface SheetProps {
  title: string
  onClose(): void
  children: ReactNode
  /** Stacks above another sheet (pickers opened from a sheet). */
  layer?: 'sheet' | 'picker'
  /** While true (work in progress), the overlay and Escape do not close the sheet. */
  locked?: boolean
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isTopmost = (el: HTMLElement | null) => {
  const layers = document.querySelectorAll('.ccb-layer')
  return !!el && layers[layers.length - 1] === el
}

export function Sheet({ title, onClose, children, layer = 'sheet', locked = false }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = locked ? () => {} : onClose

  // Focus in on open; back to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const p = panel.current!
    const target = p.querySelector<HTMLElement>('[data-autofocus]') ?? p.querySelector<HTMLElement>(FOCUSABLE) ?? p
    target.focus()
    return () => {
      if (trigger && trigger.isConnected) trigger.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost sheet closes.
      if (e.key === 'Escape' && isTopmost(ref.current)) close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !isTopmost(ref.current)) return
    const items = Array.from(panel.current!.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!items.length) return e.preventDefault()
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panel.current!.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !panel.current!.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div ref={ref} className={`ccb-layer ccb-layer-${layer}`}>
      <div className="overlay" data-testid={`${layer}-overlay`} onClick={() => close.current()} />
      <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={trapTab}>
        <div className="grab" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
