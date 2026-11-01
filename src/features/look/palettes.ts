// Card palettes and app looks (docs/intent/phase-1.md §2). Values from the approved prototype.
export interface Palette {
  id: string
  name: string
  /** Vivid accent. */
  acc: string
  /** Page background tint. */
  bg: string
  /** Light soft tone. */
  soft: string
  /** Deep tone (selected card tile). */
  deep: string
}

export const PALETTES: readonly Palette[] = [
  { id: 'blue', name: 'Blue', acc: '#1f6feb', bg: '#edf1f7', soft: '#dde8fb', deep: '#0f2747' },
  { id: 'gold', name: 'Gold', acc: '#e0a800', bg: '#f5f2ea', soft: '#fbefc9', deep: '#2a220b' },
  { id: 'lime', name: 'Lime', acc: '#a3d900', bg: '#f0f3ea', soft: '#ecf7cf', deep: '#15180f' },
  { id: 'green', name: 'Green', acc: '#16a34a', bg: '#edf4ef', soft: '#d9f2e2', deep: '#0f2a1b' },
  { id: 'violet', name: 'Violet', acc: '#7c3aed', bg: '#f1effa', soft: '#e7defd', deep: '#1f1440' },
  { id: 'rose', name: 'Rose', acc: '#db2777', bg: '#f7eff3', soft: '#fbdcea', deep: '#3a0f22' },
  { id: 'orange', name: 'Orange', acc: '#ea580c', bg: '#f7f0ea', soft: '#fde3d2', deep: '#3a1a08' },
  { id: 'graphite', name: 'Graphite', acc: '#111318', bg: '#eef0f2', soft: '#e2e5ea', deep: '#111318' },
]

export const paletteOf = (id: string | undefined): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0]

/** Owner chip colours, given out in turn as owners are added (as in the prototype). */
export const OWNER_COLORS = ['#2563eb', '#db2777', '#ca8a04', '#7c3aed', '#0d9488', '#ea580c'] as const
export const ownerColor = (index: number) => OWNER_COLORS[index % OWNER_COLORS.length]

export type Look = 'clean' | 'soft' | 'bold'
export const LOOKS: readonly { id: Look; name: string }[] = [
  { id: 'clean', name: 'Clean' },
  { id: 'soft', name: 'Soft' },
  { id: 'bold', name: 'Bold' },
]
export const isLook = (v: unknown): v is Look => LOOKS.some((l) => l.id === v)

/** Dark or white text, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58 ? '#111318' : '#ffffff'
}

/**
 * CSS custom properties for a palette in a look. The selected card tile (`--tile`) and the Bill "To pay" box
 * (`--hero`) never share a colour in any look.
 */
export function tokensFor(p: Palette, look: Look): Record<string, string> {
  const base = {
    '--acc': p.acc,
    '--acc-ink': inkOn(p.acc),
    '--acc-soft': p.soft,
    '--pbg': p.bg,
    '--pdeep': p.deep,
    '--bg': p.bg,
    '--hero': p.soft,
    '--hero-ink': '#111318',
    '--hero-line': 'transparent',
    '--tile': p.deep,
    '--r': '18px',
    '--r-sm': '12px',
  }
  if (look === 'soft') return { ...base, '--hero': '#ffffff', '--hero-line': p.soft, '--r': '26px', '--r-sm': '16px' }
  if (look === 'bold') return { ...base, '--bg': '#f3f3f3', '--hero': p.acc, '--hero-ink': inkOn(p.acc), '--tile': '#0b0b0c', '--r': '14px', '--r-sm': '10px' }
  return base
}
