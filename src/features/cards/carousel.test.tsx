// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveCard } from '../../data/cards'
import { freshNewDb } from '../../../test/data/oldDb'
import { renderScreen } from '../../test-utils/ui'
import { PREF_KEYS, prefGet } from '../look/prefs'
import { BillPage } from '../bill/BillPage'
import { CardCarousel, plainTiles, SETTLE_MS, type CardTile } from './CardCarousel'
import { keyTarget, nearestIndex, scrollLeftFor, snapIndex, swipeTarget, SWIPE_PX } from './carousel'

describe('carousel arithmetic', () => {
  // Three 240px cards with 12px gaps after a 63px spacer, in a 390px viewport (a 390px phone).
  const items = [0, 1, 2].map((i) => ({ left: 75 + i * 252, width: 240 }))
  const centreOn = (i: number) => scrollLeftFor(items[i], 390)

  it('the snapped card is the one whose centre is nearest the viewport centre', () => {
    expect(snapIndex(0, 390, items)).toBe(0)
    expect(snapIndex(centreOn(1), 390, items)).toBe(1)
    expect(snapIndex(centreOn(2), 390, items)).toBe(2)
    // Just short of halfway between two cards still snaps back; just past it snaps on.
    expect(snapIndex(centreOn(0) + 125, 390, items)).toBe(0)
    expect(snapIndex(centreOn(0) + 127, 390, items)).toBe(1)
    // Over-scrolled past the last card.
    expect(snapIndex(5_000, 390, items)).toBe(2)
    expect(snapIndex(0, 390, [])).toBe(-1)
  })

  it('nearestIndex picks the closest centre, the first on a tie', () => {
    expect(nearestIndex(10, [0, 20])).toBe(0)
    expect(nearestIndex(11, [0, 20])).toBe(1)
    expect(nearestIndex(5, [])).toBe(-1)
  })

  it('scrollLeftFor centres an item and never goes below 0', () => {
    expect(scrollLeftFor({ left: 327, width: 240 }, 390)).toBe(252)
    expect(scrollLeftFor({ left: 10, width: 100 }, 390)).toBe(0)
  })

  it('keys: arrows step by one and stop at the ends; Home and End jump; other keys do nothing', () => {
    expect(keyTarget('ArrowRight', 0, 3)).toBe(1)
    expect(keyTarget('ArrowRight', 2, 3)).toBe(2)
    expect(keyTarget('ArrowLeft', 2, 3)).toBe(1)
    expect(keyTarget('ArrowLeft', 0, 3)).toBe(0)
    expect(keyTarget('Home', 2, 3)).toBe(0)
    expect(keyTarget('End', 0, 3)).toBe(2)
    expect(keyTarget('Enter', 0, 3)).toBeNull()
    expect(keyTarget('ArrowRight', 0, 0)).toBeNull()
  })

  it('a swipe of more than 50px moves one card; a small one snaps back; the ends hold', () => {
    expect(SWIPE_PX).toBe(50)
    expect(swipeTarget(0, -51, 3)).toBe(1)
    expect(swipeTarget(0, -400, 3)).toBe(1)
    expect(swipeTarget(1, 60, 3)).toBe(0)
    expect(swipeTarget(1, 49, 3)).toBe(1)
    expect(swipeTarget(1, -49, 3)).toBe(1)
    expect(swipeTarget(2, -80, 3)).toBe(2)
    expect(swipeTarget(0, 80, 3)).toBe(0)
  })
})

const TILES: CardTile[] = [
  { id: 'bca', name: 'BCA Keluarga', bank: 'BCA', last4: '1234', palette: 'blue', caption: 'Nov 2026 bill · due 28 Nov', total: 1_500_000 },
  { id: 'mdr', name: 'Mandiri Pribadi', bank: 'Mandiri', last4: '9876', palette: 'gold', caption: 'No statement yet', total: null },
  { id: 'bni', name: 'BNI Kantor', bank: 'BNI', palette: 'green' },
]

/** A carousel whose selection lives in state, as the screens' does (the selected card drives the screen). */
function Harness({ onSelect, start = 'bca', add }: { onSelect?: (id: string) => void; start?: string; add?: boolean }) {
  const [id, setId] = useState(start)
  return (
    <MemoryRouter>
      <div className="ccb">
        <CardCarousel
          tiles={TILES}
          selectedId={id}
          onSelect={(next) => {
            onSelect?.(next)
            setId(next)
          }}
          addHref={add ? '/settings' : undefined}
        />
        <output data-testid="screen-card">{id}</output>
      </div>
    </MemoryRouter>
  )
}

const group = () => screen.getByRole('group', { name: 'Cards' })
const tile = (name: RegExp | string) => within(group()).getByRole('button', { name })
const pressed = () =>
  within(group())
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label'))

/** jsdom has no layout: give each tile a box (240px wide, 12px apart after a 75px spacer) and the row a 390px viewport. */
function fakeLayout() {
  const indexOf = (el: HTMLElement) => Array.from(el.parentElement?.querySelectorAll('[data-card]') ?? []).indexOf(el)
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-card') ? 75 + indexOf(this) * 252 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-card') ? 240 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('cards') ? 390 : 0
  })
}

class FakePointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
    this.pointerType = init.pointerType ?? ''
  }
}

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollTo = vi.fn(function (this: HTMLElement, o: ScrollToOptions) {
    this.scrollLeft = o.left ?? 0
  })
  ;(HTMLElement.prototype as { scrollTo?: unknown }).scrollTo = scrollTo
  vi.stubGlobal('PointerEvent', FakePointerEvent)
  vi.stubGlobal('__APP_ENV__', 'production')
})
afterEach(() => {
  cleanup()
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

describe('CardCarousel', () => {
  it('renders each card in its palette with its bank and last 4 digits; the selected one is pressed and labelled', () => {
    render(<Harness add />)
    expect(group().getAttribute('aria-roledescription')).toBe('carousel')
    const bca = tile('BCA Keluarga Rp 1.500.000')
    expect(bca.getAttribute('aria-pressed')).toBe('true')
    expect(bca.style.getPropertyValue('--c')).toBe('#1f6feb')
    expect(bca.style.getPropertyValue('--fill')).toBe('var(--tile)')
    expect(bca.textContent).toContain('BCA · •••• 1234')
    expect(bca.textContent).toContain('Nov 2026 bill · due 28 Nov')
    // Described by its bank, number and position, for screen readers.
    expect(document.getElementById(bca.getAttribute('aria-describedby')!)!.textContent).toBe('BCA KeluargaBCA · •••• 1234, card 1 of 3')

    const mdr = tile('Mandiri Pribadi')
    expect(mdr.getAttribute('aria-pressed')).toBe('false')
    // Not selected: its own deep tone (shown while it is centred mid-swipe) and its own accent.
    expect(mdr.style.getPropertyValue('--c')).toBe('#e0a800')
    expect(mdr.style.getPropertyValue('--fill')).toBe('#2a220b')
    expect(mdr.textContent).toContain('—') // no statement yet
    // A tile without a total shows the card number, or the bank when there is none.
    expect(tile('BNI Kantor').querySelector('.amt')!.textContent).toBe('BNI')
    expect(within(group()).getByRole('link', { name: '+ Add card' }).getAttribute('href')).toBe('/settings')
    // Roving focus: only the selected card is in the tab order.
    expect(bca.tabIndex).toBe(0)
    expect(mdr.tabIndex).toBe(-1)
    // Page dots, one per card, the first on.
    expect(Array.from(document.querySelectorAll('.dots i')).map((i) => i.className)).toEqual(['on', '', ''])
  })

  it('tapping a peeking card selects it; the screen follows and the row glides to it', async () => {
    const onSelect = vi.fn()
    fakeLayout()
    render(<Harness onSelect={onSelect} />)
    // On first render the selected card is centred without animation.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'auto' })
    await userEvent.setup().click(tile('Mandiri Pribadi'))
    expect(onSelect).toHaveBeenCalledWith('mdr')
    expect(screen.getByTestId('screen-card').textContent).toBe('mdr')
    expect(pressed()).toEqual(['Mandiri Pribadi'])
    expect(scrollTo).toHaveBeenLastCalledWith({ left: scrollLeftFor({ left: 327, width: 240 }, 390), behavior: 'smooth' })
    expect(screen.getByText('Mandiri Pribadi selected, card 2 of 3')).toBeTruthy()
    // Tapping the selected card again does not re-select it.
    onSelect.mockClear()
    await userEvent.setup().click(tile('Mandiri Pribadi'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('reduced motion: the row jumps instead of gliding', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    fakeLayout()
    render(<Harness />)
    await userEvent.setup().click(tile('BNI Kantor'))
    expect(scrollTo).toHaveBeenLastCalledWith({ left: scrollLeftFor({ left: 579, width: 240 }, 390), behavior: 'auto' })
  })

  it('keyboard: arrows move the selection and the focus, Home and End jump, the ends hold', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)
    tile(/^BCA Keluarga/).focus()
    await user.keyboard('{ArrowLeft}')
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenLastCalledWith('mdr')
    expect(document.activeElement).toBe(tile('Mandiri Pribadi'))
    expect(tile('Mandiri Pribadi').tabIndex).toBe(0)
    await user.keyboard('{End}')
    expect(onSelect).toHaveBeenLastCalledWith('bni')
    expect(document.activeElement).toBe(tile('BNI Kantor'))
    await user.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenCalledTimes(2)
    await user.keyboard('{Home}')
    expect(onSelect).toHaveBeenLastCalledWith('bca')
    expect(pressed()).toEqual(['BCA Keluarga Rp 1.500.000'])
    // Other keys are left alone.
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('swiping: the card snapped in the centre becomes selected when the row settles (scrollend)', () => {
    const onSelect = vi.fn()
    fakeLayout()
    render(<Harness onSelect={onSelect} />)
    const row = group()
    row.scrollLeft = scrollLeftFor({ left: 579, width: 240 }, 390) - 30 // almost centred on the third card
    fireEvent.scroll(row)
    // While the row moves, the dots follow the centred card but the selection waits.
    expect(Array.from(document.querySelectorAll('.dots i')).map((i) => i.className)).toEqual(['', '', 'on'])
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent(row, new Event('scrollend'))
    expect(onSelect).toHaveBeenCalledWith('bni')
    expect(screen.getByTestId('screen-card').textContent).toBe('bni')
  })

  it('swiping without scrollend support: the selection follows once scrolling has been quiet for a moment', () => {
    vi.useFakeTimers()
    const onSelect = vi.fn()
    fakeLayout()
    render(<Harness onSelect={onSelect} />)
    const row = group()
    row.scrollLeft = scrollLeftFor({ left: 327, width: 240 }, 390)
    fireEvent.scroll(row)
    act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
    expect(onSelect).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onSelect).toHaveBeenCalledWith('mdr')
    // Settling on the card that is already selected changes nothing.
    fireEvent.scroll(row)
    act(() => vi.advanceTimersByTime(SETTLE_MS))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('mouse drag: more than 50px moves one card, less snaps back, and the drag is not taken as a tap', () => {
    const onSelect = vi.fn()
    fakeLayout()
    render(<Harness onSelect={onSelect} />)
    const row = group()
    const drag = (from: number, to: number) => {
      fireEvent.pointerDown(row, { pointerType: 'mouse', pointerId: 1, button: 0, clientX: from })
      fireEvent.pointerMove(row, { pointerType: 'mouse', pointerId: 1, clientX: (from + to) / 2 })
      fireEvent.pointerMove(row, { pointerType: 'mouse', pointerId: 1, clientX: to })
      expect(row.classList.contains('dragging')).toBe(true)
      fireEvent.pointerUp(row, { pointerType: 'mouse', pointerId: 1, clientX: to })
      expect(row.classList.contains('dragging')).toBe(false)
    }
    // A short drag: back to the selected card, nothing selected.
    drag(200, 170)
    fireEvent.click(tile('Mandiri Pribadi')) // the click that ends a drag is swallowed
    expect(onSelect).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })
    // A long drag to the left: the next card.
    drag(300, 220)
    expect(onSelect).toHaveBeenLastCalledWith('mdr')
    // Dragging right goes back.
    drag(100, 200)
    expect(onSelect).toHaveBeenLastCalledWith('bca')
    // Touch is left to the browser's own scrolling (scroll-snap).
    fireEvent.pointerDown(row, { pointerType: 'touch', pointerId: 2, button: 0, clientX: 300 })
    fireEvent.pointerMove(row, { pointerType: 'touch', pointerId: 2, clientX: 100 })
    expect(row.classList.contains('dragging')).toBe(false)
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('a resize re-centres the selected card', () => {
    fakeLayout()
    render(<Harness start="mdr" />)
    scrollTo.mockClear()
    window.dispatchEvent(new Event('resize'))
    expect(scrollTo).toHaveBeenCalledWith({ left: scrollLeftFor({ left: 327, width: 240 }, 390), behavior: 'auto' })
  })

  it('without Element.scrollTo it sets scrollLeft', () => {
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    fakeLayout()
    render(<Harness start="bni" />)
    expect(group().scrollLeft).toBe(scrollLeftFor({ left: 579, width: 240 }, 390))
  })

  it('one card: no dots and no announcement', () => {
    render(
      <MemoryRouter>
        <CardCarousel tiles={TILES.slice(0, 1)} selectedId="bca" onSelect={() => {}} />
      </MemoryRouter>,
    )
    expect(document.querySelector('.dots')).toBeNull()
    expect(document.querySelector('[aria-live]')!.textContent).toBe('')
  })

  it('plainTiles keeps name, bank, last 4 and palette, without totals', () => {
    expect(plainTiles([{ card: { id: 'a', name: 'A', bank: 'BCA', last4: '1', palette: 'rose' } }])).toEqual([{ id: 'a', name: 'A', bank: 'BCA', last4: '1', palette: 'rose' }])
  })
})

describe('the carousel on Bill', () => {
  it('the selected card persists in the env-prefixed prefs and drives the palette', async () => {
    const db = freshNewDb()
    await saveCard(db, { name: 'BCA Keluarga', bank: 'BCA', last4: '1234', statementDay: '12', palette: 'blue', owners: [{ name: 'Andi', color: '#2563eb' }], defaultIndex: 0 })
    const mdr = await saveCard(db, { name: 'Mandiri Pribadi', bank: 'Mandiri', last4: '9876', statementDay: '11', palette: 'gold', owners: [{ name: 'Andi', color: '#2563eb' }], defaultIndex: 0 })
    const { user } = renderScreen(<BillPage />, { db })
    const cards = await screen.findByRole('group', { name: 'Cards' })
    await waitFor(() => expect(within(cards).getByRole('button', { name: 'BCA Keluarga' }).getAttribute('aria-pressed')).toBe('true'))
    expect(within(cards).getByRole('button', { name: 'BCA Keluarga' }).textContent).toContain('BCA · •••• 1234')
    await user.click(within(cards).getByRole('button', { name: 'Mandiri Pribadi' }))
    await waitFor(() => expect(within(cards).getByRole('button', { name: 'Mandiri Pribadi' }).getAttribute('aria-pressed')).toBe('true'))
    expect(prefGet(PREF_KEYS.selectedCard)).toBe(mdr)
    expect(localStorage.getItem(PREF_KEYS.selectedCard)).toBe(mdr) // production: no prefix
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--acc')).toBe('#e0a800'))
  })
})
