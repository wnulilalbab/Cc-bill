// The selected card and the look. The selected card's palette colours the whole app (CSS custom properties on
// <html>), in the chosen look.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listCards, type CardWithOwners } from '../../data/cards'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { isLook, paletteOf, tokensFor, type Look, type Palette } from './palettes'
import { PREF_KEYS, prefGet, prefSet } from './prefs'

export interface Appearance {
  /** Every card with its owners; undefined while loading. */
  cards: CardWithOwners[] | undefined
  selected: CardWithOwners | undefined
  selectCard(id: string): void
  palette: Palette
  look: Look
  setLook(look: Look): void
}

const Ctx = createContext<Appearance | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { db } = useData()
  const cards = useDbQuery(() => listCards(db), [db])
  const [selectedId, setSelectedId] = useState<string | null>(() => prefGet(PREF_KEYS.selectedCard))
  const [look, setLookState] = useState<Look>(() => {
    const v = prefGet(PREF_KEYS.look)
    return isLook(v) ? v : 'clean'
  })

  const selected = cards?.find((c) => c.card.id === selectedId) ?? cards?.[0]
  const palette = paletteOf(selected?.card.palette)

  const selectCard = useCallback((id: string) => {
    setSelectedId(id)
    prefSet(PREF_KEYS.selectedCard, id)
  }, [])
  const setLook = useCallback((l: Look) => {
    setLookState(l)
    prefSet(PREF_KEYS.look, l)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const tokens = tokensFor(palette, look)
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v)
    root.dataset.look = look
  }, [palette, look])

  const value = useMemo(() => ({ cards, selected, selectCard, palette, look, setLook }), [cards, selected, selectCard, palette, look, setLook])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppearance(): Appearance {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppearance() needs an <AppearanceProvider>.')
  return v
}
