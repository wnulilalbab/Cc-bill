// Icons from the approved prototype (docs/prototype/ccbill-prototype.html). Decorative: the control carries the name.
import type { ReactNode } from 'react'

function Svg({ className, width = 1.8, children }: { className?: string; width?: number; children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function GearIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M10.3 2.6h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.7v1.9l2 1.7-1.7 2.9-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-2.9 2-1.7v-1.9l-2-1.7 1.7-2.9 2.5.9 1.6-.9z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function BackIcon() {
  return (
    <Svg width={2}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  )
}

export function BillIcon() {
  return (
    <Svg>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  )
}

export function ListIcon() {
  return (
    <Svg>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </Svg>
  )
}

export function PlusIcon() {
  return (
    <Svg width={2.2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function PayIcon() {
  return (
    <Svg>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </Svg>
  )
}
