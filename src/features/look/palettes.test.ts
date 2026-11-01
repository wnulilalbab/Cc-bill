import { describe, expect, it } from 'vitest'
import { inkOn, isLook, LOOKS, ownerColor, OWNER_COLORS, paletteOf, PALETTES, tokensFor } from './palettes'

describe('palettes and looks', () => {
  it('C-02 has the 8 palettes of the spec, each with accent, background, soft and deep tones', () => {
    expect(PALETTES.map((p) => p.name)).toEqual(['Blue', 'Gold', 'Lime', 'Green', 'Violet', 'Rose', 'Orange', 'Graphite'])
    for (const p of PALETTES) for (const c of [p.acc, p.bg, p.soft, p.deep]) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(paletteOf('rose').name).toBe('Rose')
    expect(paletteOf(undefined).id).toBe('blue')
    expect(paletteOf('nope').id).toBe('blue')
  })

  it('C-06 Clean / Soft / Bold change the tokens; the palette always applies', () => {
    const p = paletteOf('violet')
    const clean = tokensFor(p, 'clean')
    const soft = tokensFor(p, 'soft')
    const bold = tokensFor(p, 'bold')
    expect(clean['--hero']).toBe(p.soft)
    expect(soft['--hero']).toBe('#ffffff')
    expect(soft['--hero-line']).toBe(p.soft)
    expect(bold['--hero']).toBe(p.acc)
    expect(bold['--tile']).toBe('#0b0b0c')
    for (const t of [clean, soft, bold]) expect(t['--acc']).toBe(p.acc)
    expect(new Set([clean['--r'], soft['--r'], bold['--r']]).size).toBe(3)
    expect(LOOKS.map((l) => l.id)).toEqual(['clean', 'soft', 'bold'])
    expect(isLook('soft')).toBe(true)
    expect(isLook('dark')).toBe(false)
  })

  it('U-08 the To-pay box never has the selected card tile colour, in every palette and look', () => {
    for (const p of PALETTES) for (const l of LOOKS) {
      const t = tokensFor(p, l.id)
      expect(t['--hero']).not.toBe(t['--tile'])
    }
  })

  it('picks readable text on the accent and cycles owner colours', () => {
    expect(inkOn('#a3d900')).toBe('#111318')
    expect(inkOn('#1f6feb')).toBe('#ffffff')
    expect(ownerColor(0)).toBe(OWNER_COLORS[0])
    expect(ownerColor(OWNER_COLORS.length + 1)).toBe(OWNER_COLORS[1])
  })
})
