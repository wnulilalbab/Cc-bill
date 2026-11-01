// Custom picker (no native <select>, docs/intent/phase-1.md §2): a button that opens a bottom-sheet list.
import { useState } from 'react'
import { Sheet } from './Sheet'

export interface PickerOption {
  value: string
  label: string
  /** Second line under the label. */
  sub?: string
}

export interface PickerProps {
  /** Sheet title, also the button's accessible name prefix. */
  title: string
  value: string
  options: readonly PickerOption[]
  onChange(value: string): void
  /** Wide button for form fields. */
  field?: boolean
}

export function Picker({ title, value, options, onChange, field }: PickerProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button type="button" className={`pick${field ? ' field-pick' : ''}`} aria-label={`${title}: ${current?.label ?? 'Choose'}`} aria-haspopup="listbox" onClick={() => setOpen(true)}>
        <span>{current?.label ?? 'Choose'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)} layer="picker" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              className="opt"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span>
                {o.label}
                {o.sub && <span className="s">{o.sub}</span>}
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </>
  )
}
