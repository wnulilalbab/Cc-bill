// Bottom sheet: an overlay plus a panel sliding up from the bottom. Tapping the overlay or Escape closes it.
import { useEffect, useRef, type ReactNode } from 'react'

export interface SheetProps {
  title: string
  onClose(): void
  children: ReactNode
  /** Stacks above another sheet (pickers opened from a sheet). */
  layer?: 'sheet' | 'picker'
  role?: 'dialog' | 'listbox'
}

export function Sheet({ title, onClose, children, layer = 'sheet', role = 'dialog' }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost sheet closes.
      const layers = document.querySelectorAll('.ccb-layer')
      if (e.key === 'Escape' && layers[layers.length - 1] === ref.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={ref} className={`ccb-layer ccb-layer-${layer}`}>
      <div className="overlay" data-testid={`${layer}-overlay`} onClick={onClose} />
      <div className="sheet" role={role} aria-modal={role === 'dialog' ? true : undefined} aria-label={title}>
        <div className="grab" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
