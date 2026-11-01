// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Picker } from './Picker'
import { Sheet } from './Sheet'

afterEach(cleanup)

function SheetHarness({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ccb">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Sheet title="Sample" onClose={() => setOpen(false)}>
          {!empty && (
            <>
              <input aria-label="First" />
              <button type="button">Middle</button>
              <button type="button" onClick={() => setOpen(false)}>
                Last
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  )
}

describe('Sheet accessibility', () => {
  it('moves focus in on open, traps Tab inside, and returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<SheetHarness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Sample' })
    expect(document.activeElement).toBe(screen.getByLabelText('First'))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Middle' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
    await user.tab() // wraps to the first
    expect(document.activeElement).toBe(screen.getByLabelText('First'))
    await user.tab({ shift: true }) // wraps to the last
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('focuses the panel itself when it has nothing focusable, and keeps Tab there', async () => {
    const user = userEvent.setup()
    render(<SheetHarness empty />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Sample' })
    expect(document.activeElement).toBe(dialog)
    await user.tab()
    expect(document.activeElement).toBe(dialog)
  })

  it('a locked sheet ignores Escape and the overlay', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <div className="ccb">
        <Sheet title="Busy" onClose={onClose} locked>
          <button type="button">Only</button>
        </Sheet>
      </div>,
    )
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('sheet-overlay'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Picker accessibility', () => {
  function PickerHarness() {
    const [v, setV] = useState('b')
    return <Picker title="Letter" value={v} onChange={setV} options={['a', 'b', 'c', 'd'].map((x) => ({ value: x, label: x.toUpperCase() }))} />
  }

  it('the title sits outside the listbox; arrows, Home and End move between options; focus starts on the selected one', async () => {
    const user = userEvent.setup()
    render(<PickerHarness />)
    const trigger = screen.getByRole('button', { name: 'Letter: B' })
    await user.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Letter' })
    expect(within(listbox).queryByRole('heading')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Letter' }).querySelector('h2')!.textContent).toBe('Letter')
    const option = (n: string) => within(listbox).getByRole('option', { name: n })
    expect(document.activeElement).toBe(option('B'))

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(option('C'))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(option('D'))
    await user.keyboard('{ArrowDown}') // stays on the last
    expect(document.activeElement).toBe(option('D'))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(option('A'))
    await user.keyboard('{ArrowUp}') // stays on the first
    expect(document.activeElement).toBe(option('A'))
    await user.keyboard('x') // other keys do nothing
    expect(document.activeElement).toBe(option('A'))

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Letter: C' })).toBe(document.activeElement)
  })

  it('focuses the first option when nothing is selected', async () => {
    const user = userEvent.setup()
    render(<Picker title="Empty" value="" onChange={() => {}} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} />)
    await user.click(screen.getByRole('button', { name: 'Empty: Choose' }))
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'X' }))
  })
})
