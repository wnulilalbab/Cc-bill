// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveCard } from '../../data/cards'
import { freshNewDb } from '../../../test/data/oldDb'
import { renderScreen, settle } from '../../test-utils/ui'
import { PREF_KEYS, prefGet } from '../look/prefs'
import { PaymentsPage } from '../payments/PaymentsPage'
import { TransactionsPage } from '../transactions/TransactionsPage'
import { CardBar } from './CardBar'
import type { CardTile } from './CardCarousel'

class FakePointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
    this.pointerType = init.pointerType ?? ''
  }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent)
  vi.stubGlobal('__APP_ENV__', 'production')
})
afterEach(async () => {
  await settle() // the last action's reads finish inside the test, on every run
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const TILES: CardTile[] = [
  { id: 'bca', name: 'BCA Keluarga', bank: 'BCA', last4: '1234', palette: 'blue' },
  { id: 'mdr', name: 'Mandiri Pribadi', bank: 'Mandiri', last4: '9876', palette: 'gold' },
  { id: 'bni', name: 'BNI Kantor', bank: 'BNI', palette: 'green' },
]

function Harness({ onSelect }: { onSelect: (id: string) => void }) {
  const [id, setId] = useState('bca')
  return (
    <div className="ccb">
      <CardBar
        tiles={TILES}
        selectedId={id}
        onSelect={(next) => {
          onSelect(next)
          setId(next)
        }}
      />
    </div>
  )
}

const bar = () => screen.getByRole('button', { name: /^Card: / })
const swipe = (from: number, to: number, pointerType = 'touch') => {
  fireEvent.pointerDown(bar(), { pointerType, pointerId: 1, clientX: from })
  fireEvent.pointerUp(bar(), { pointerType, pointerId: 1, clientX: to })
  fireEvent.click(bar()) // the click that ends a swipe
}

describe('CardBar', () => {
  it('shows the selected card in its palette with its last 4 digits and bank', () => {
    render(<Harness onSelect={() => {}} />)
    expect(bar().getAttribute('aria-label')).toBe('Card: BCA Keluarga •••• 1234')
    expect(bar().textContent).toBe('BCA Keluarga · •••• 1234BCA')
    expect(bar().style.getPropertyValue('--c')).toBe('#1f6feb')
    expect(bar().getAttribute('aria-haspopup')).toBe('listbox')
  })

  it('U-03 tap opens the card picker; picking a card selects it and the bar slides that way', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)
    await user.click(bar())
    const list = screen.getByRole('listbox', { name: 'Card' })
    expect(within(list).getByRole('option', { name: /BCA Keluarga/ }).getAttribute('aria-selected')).toBe('true')
    expect(within(list).getByRole('option', { name: /BNI Kantor/ }).textContent).toBe('BNI KantorBNI')
    await user.click(within(list).getByRole('option', { name: /BNI Kantor/ }))
    expect(onSelect).toHaveBeenLastCalledWith('bni')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(bar().className).toBe('cbar slide-next')
    fireEvent.animationEnd(bar())
    expect(bar().className).toBe('cbar')
    // Picking the selected card again changes nothing.
    await user.click(bar())
    await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: /BNI Kantor/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('swipe: more than 50px moves to the next or previous card without opening the picker; a short swipe does nothing', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    swipe(300, 230)
    expect(onSelect).toHaveBeenLastCalledWith('mdr')
    expect(bar().className).toBe('cbar slide-next')
    expect(screen.queryByRole('listbox')).toBeNull()
    swipe(100, 160, 'mouse')
    expect(onSelect).toHaveBeenLastCalledWith('bca')
    expect(bar().className).toBe('cbar slide-prev')
    swipe(100, 70)
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('listbox')).toBeNull()
    // The first card holds at the start.
    swipe(100, 300)
    expect(onSelect).toHaveBeenCalledTimes(2)
    // A pointer that went up elsewhere is ignored.
    fireEvent.pointerDown(bar(), { pointerId: 1, clientX: 300 })
    fireEvent.pointerCancel(bar(), { pointerId: 1 })
    fireEvent.pointerUp(bar(), { pointerId: 1, clientX: 100 })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('arrow keys switch cards; other keys are left alone', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)
    bar().focus()
    await user.keyboard('{ArrowLeft}')
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(onSelect.mock.calls).toEqual([['mdr'], ['bni']])
    expect(document.activeElement).toBe(bar())
    await user.keyboard('{ArrowRight}{Home}')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

describe('the card bar on Transactions and Payments', () => {
  it.each([
    ['Transactions', <TransactionsPage key="t" />],
    ['Payments', <PaymentsPage key="p" />],
  ])('%s: a slim bar, not the carousel; switching persists in the prefs and drives the palette', async (_name, page) => {
    const db = freshNewDb()
    await saveCard(db, { name: 'BCA Keluarga', bank: 'BCA', last4: '1234', statementDay: '12', palette: 'blue', owners: [{ name: 'Andi', color: '#2563eb' }], defaultIndex: 0 })
    const mdr = await saveCard(db, { name: 'Mandiri Pribadi', bank: 'Mandiri', last4: '9876', statementDay: '11', palette: 'gold', owners: [{ name: 'Andi', color: '#2563eb' }], defaultIndex: 0 })
    const { user } = renderScreen(page, { db })
    expect(await screen.findByRole('button', { name: 'Card: BCA Keluarga •••• 1234' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Cards' })).toBeNull()
    // Swipe to the next card.
    swipe(300, 200)
    await screen.findByRole('button', { name: 'Card: Mandiri Pribadi •••• 9876' })
    expect(prefGet(PREF_KEYS.selectedCard)).toBe(mdr)
    expect(localStorage.getItem(PREF_KEYS.selectedCard)).toBe(mdr) // production: no prefix
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--acc')).toBe('#e0a800'))
    // And back through the picker.
    await user.click(bar())
    await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: /BCA Keluarga/ }))
    await screen.findByRole('button', { name: 'Card: BCA Keluarga •••• 1234' })
    expect(prefGet(PREF_KEYS.selectedCard)).not.toBe(mdr)
  })
})
