// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshNewDb } from '../../../test/data/oldDb'
import { aiAnswerFor, expected, fileOf, mockFetch, pdfjsLib, seedCards, TEST_KEY } from '../../../test/import/helpers'
import type { FetchLike } from '../../ai/client'
import { recallPassword, rememberPassword } from '../../import/passwords'
import { renderScreen, settle } from '../../test-utils/ui'
import { saveAiKey } from '../settings/aiSettings'
import { ImportPage, parseTyped } from './ImportPage'

// Reading a PDF with pdf.js is slow under coverage instrumentation: wait longer than the 1 s default.
configure({ asyncUtilTimeout: 8000 })

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
  saveAiKey(TEST_KEY)
})
afterEach(async () => {
  await settle() // the last action's reads finish inside the test, on every run
  cleanup()
  vi.unstubAllGlobals()
})

const pdfjs = async () => pdfjsLib
const asFile = (path: string, name?: string) => {
  const f = fileOf(path, name)
  return new File([f.bytes as Uint8Array<ArrayBuffer>], f.name, { type: f.type })
}

async function setup(fetch: FetchLike) {
  const db = freshNewDb()
  const cards = await seedCards(db)
  const r = renderScreen(<ImportPage pdfjs={pdfjs} fetch={fetch} />, { db })
  await screen.findByRole('button', { name: /^Card: / })
  return { ...r, db, cards }
}

async function pickCard(user: Awaited<ReturnType<typeof setup>>['user'], name: string) {
  await user.click(screen.getByRole('button', { name: /^Card: / }))
  await user.click(within(screen.getByRole('listbox', { name: 'Card' })).getByRole('option', { name: new RegExp(name) }))
}

const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText(/Statement PDF|Screenshots from the bank app/), { target: { files } })

describe('Import screen', () => {
  it('I-03 / I-04 locked Mandiri PDF: wrong then right password, remembered for the next import; totals match; saved', async () => {
    const fetch = mockFetch(aiAnswerFor(expected('statements/mandiri-2026-10')), aiAnswerFor(expected('statements/mandiri-2026-11')))
    const { user, db, cards } = await setup(fetch)
    await pickCard(user, 'Mandiri Pribadi')
    choose(asFile('statements/mandiri-2026-10.pdf', 'CC_eBilling2026-10-11.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This PDF is locked. Type its password.')

    await user.type(screen.getByLabelText('PDF password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Unlock and read' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("That password didn't open the file. Try again."))
    expect(fetch).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('PDF password'))
    await user.type(screen.getByLabelText('PDF password'), 'test1234')
    const remember = screen.getByRole('checkbox', { name: /Remember for this card/ }) as HTMLInputElement
    expect(remember.checked).toBe(false) // unticked by default
    await user.click(remember)
    await user.click(screen.getByRole('button', { name: 'Unlock and read' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(screen.getByText('8 lines found')).toBeTruthy()
    expect(within(screen.getByText('Refunds').parentElement!).getByText('1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save statement' }))
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
    expect(screen.getByText(/new, needs assigning/)).toBeTruthy()
    expect(await recallPassword(db, cards.mandiri)).toBe('test1234')

    // Next import asks nothing.
    await user.click(screen.getByRole('button', { name: 'Import another' }))
    await pickCard(user, 'Mandiri Pribadi')
    choose(asFile('statements/mandiri-2026-11.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(screen.queryByLabelText('PDF password')).toBeNull()

    // Forget clears it: the next import asks again.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(await screen.findByRole('button', { name: 'Forget saved password' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Forget saved password' })).toBeNull())
    expect(await recallPassword(db, cards.mandiri)).toBeNull()
  })

  it('I-05 the first PDF import of a card asks for the holder name once; it is saved on the card and never sent', async () => {
    const fetch = mockFetch(aiAnswerFor(expected('statements/bca-2026-07')))
    const { user, db, cards } = await setup(fetch)
    await pickCard(user, 'BCA Keluarga')
    expect(screen.queryByLabelText(/Card holder name/)).toBeNull() // no file yet
    choose(asFile('statements/bca-2026-07.pdf'))
    const field = await screen.findByLabelText('Card holder name, as printed on the statement')
    expect(screen.getByText(/Asked once for BCA Keluarga/)).toBeTruthy()
    await user.type(field, '  Andi Pratama ')
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(((await db.cards.get(cards.bca)) as { holderName?: string }).holderName).toBe('Andi Pratama')
    const body = String(fetch.mock.calls[0][1].body)
    expect(body).not.toMatch(/PRATAMA/i)
    // Asked once: the next PDF for this card does not ask again.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    choose(asFile('statements/bca-2026-08.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByLabelText(/Card holder name/)).toBeNull()
  })

  it('I-05 a holder name typed for one card is cleared when the card changes; it is never saved on another card', async () => {
    const fetch = mockFetch(aiAnswerFor(expected('statements/bca-2026-07')))
    const { user, db, cards } = await setup(fetch)
    await pickCard(user, 'BCA Keluarga')
    choose(asFile('statements/bca-2026-07.pdf'))
    await user.type(await screen.findByLabelText(/Card holder name/), 'Andi Pratama')
    await pickCard(user, 'Mandiri Pribadi')
    expect((screen.getByLabelText(/Card holder name/) as HTMLInputElement).value).toBe('')
    await pickCard(user, 'BCA Keluarga')
    expect((screen.getByLabelText(/Card holder name/) as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(((await db.cards.get(cards.bca)) as { holderName?: string }).holderName).toBeUndefined()
    expect(((await db.cards.get(cards.mandiri)) as { holderName?: string }).holderName).toBeUndefined()
  })

  it('I-05 the holder name question: only for a statement PDF; left empty, nothing is saved', async () => {
    const fetch = mockFetch(aiAnswerFor(expected('statements/bca-2026-07')))
    const { user, db, cards } = await setup(fetch)
    await pickCard(user, 'BCA Keluarga')
    choose(asFile('statements/bca-2026-07.pdf'))
    await screen.findByLabelText(/Card holder name/)
    await user.click(screen.getByRole('button', { name: 'Unbilled screenshots' }))
    expect(screen.queryByLabelText(/Card holder name/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Statement' }))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(((await db.cards.get(cards.bca)) as { holderName?: string }).holderName).toBeUndefined()
  })

  it('I-04 without Remember nothing is saved; unticking Remember deletes a password saved earlier', async () => {
    const fetch = mockFetch(aiAnswerFor(expected('statements/mandiri-2026-10')))
    const { user, db, cards } = await setup(fetch)
    await rememberPassword(db, cards.mandiri, 'old-wrong')
    await pickCard(user, 'Mandiri Pribadi')
    expect(await screen.findByRole('button', { name: 'Forget saved password' })).toBeTruthy()
    choose(asFile('statements/mandiri-2026-10.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    // The remembered password no longer works: it is dropped and the password is asked for.
    expect(await screen.findByLabelText('PDF password')).toBeTruthy()
    expect(await recallPassword(db, cards.mandiri)).toBeNull()
    await rememberPassword(db, cards.mandiri, 'again')
    const remember = screen.getByRole('checkbox', { name: /Remember for this card/ })
    await user.click(remember)
    await user.click(remember)
    await waitFor(async () => expect(await recallPassword(db, cards.mandiri)).toBeNull())
    await user.type(screen.getByLabelText('PDF password'), 'test1234')
    await user.click(screen.getByRole('button', { name: 'Unlock and read' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect(await recallPassword(db, cards.mandiri)).toBeNull()
  })

  it('I-02 corrupt October: "Totals differ by Rp 1"; fixing the row re-runs the check', async () => {
    const { user } = await setup(mockFetch(aiAnswerFor(expected('statements/bca-2026-10-corrupt'))))
    choose(asFile('statements/bca-2026-10-corrupt.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('Totals differ by Rp 1')).toBeTruthy()
    // Saving with a difference needs a confirmation; "Go back" leaves the review as it was.
    await user.click(screen.getByRole('button', { name: 'Save with a difference of Rp 1' }))
    expect(screen.getByRole('alertdialog', { name: 'Save with a difference?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    const row = screen.getByLabelText('GRAMEDIA MATRAMAN 245.001')
    await user.click(within(row).getByRole('button', { name: 'Fix amount' }))
    const input = within(row).getByLabelText('Amount for GRAMEDIA MATRAMAN')
    await user.clear(input)
    await user.type(input, '245.000')
    await user.click(within(row).getByRole('button', { name: 'Save amount' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save statement' }))
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
    expect(screen.getByText(/the original purchase was not found/)).toBeTruthy()
  })

  it('I-02 Save anyway saves the statement with its difference', async () => {
    const { user } = await setup(mockFetch(aiAnswerFor(expected('statements/bca-2026-10-corrupt'))))
    choose(asFile('statements/bca-2026-10-corrupt.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    await user.click(await screen.findByRole('button', { name: 'Save with a difference of Rp 1' }))
    await user.click(screen.getByRole('button', { name: 'Save anyway' }))
    expect(await screen.findByText(/Totals differ by Rp 1\./)).toBeTruthy()
  })

  it('an AI total that disagrees with the printed one blocks "match" until the printed figure is used', async () => {
    const e = expected('statements/bca-2026-10')
    const answer = aiAnswerFor(e)
    answer.totals.prevBalance = 1
    const { user } = await setup(mockFetch(answer))
    choose(asFile('statements/bca-2026-10.pdf', '22965532_SEP_2026.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText("Totals can't be confirmed")).toBeTruthy()
    expect(screen.getByText(/The file name says Sep 2026, but the statement is dated Oct 2026/)).toBeTruthy()
    expect(screen.queryByText('Totals match the bank ✓')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save statement' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Use the printed figure' }))
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save statement' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a PDF without readable printed totals never shows "match"; checking by eye unlocks Save', async () => {
    const at = (str: string, y: number) => ({ str, transform: [1, 0, 0, 1, 10, y] })
    const page = { getTextContent: async () => ({ items: [at('02-OKT 03-OKT GRAMEDIA MATRAMAN 245.000', 700)] }) }
    const bare = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }) }) }
    const answer = { statementDate: '2026-10-12', dueDate: '2026-10-28', totals: { prevBalance: 0, credits: 0, purchases: 245000, feesInterest: 0, newBalance: 245000, minPayment: null }, rows: [{ page: 0, date: '2026-10-02', postDate: '2026-10-03', description: 'GRAMEDIA MATRAMAN', amount: 245000, credit: false }] }
    const db = freshNewDb()
    await seedCards(db)
    const { user } = renderScreen(<ImportPage pdfjs={async () => bare as never} fetch={mockFetch(answer)} />, { db })
    await screen.findByRole('button', { name: /^Card: / })
    choose(asFile('statements/bca-2026-10.pdf', 'scan.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText("Totals can't be confirmed")).toBeTruthy()
    expect(screen.getAllByText(/printed new balance not found/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Totals match the bank ✓')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save statement' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'I checked these against the statement' }))
    expect(await screen.findByText('Totals match the figures you checked')).toBeTruthy()
    expect(screen.queryByText('Totals match the bank ✓')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save statement' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('I-13 screenshot statement: Save waits for the typed total', async () => {
    const { user } = await setup(mockFetch(aiAnswerFor(expected('screenshots/mandiri-2026-08'))))
    await pickCard(user, 'Mandiri Pribadi')
    choose(asFile('screenshots/mandiri-2026-08-p1.png'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    const save = await screen.findByRole('button', { name: 'Save statement' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Type the bank's total from the first screenshot.")).toBeTruthy()
    await user.type(screen.getByLabelText("Bank's total on page 1 (for the totals check)"), '603.800')
    expect(await screen.findByText('Totals match the bank ✓')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save statement' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Save statement' }))
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
  })

  it('I-11 / I-10 Unbilled: duplicates ask Keep both / Skip; after the statement, the unbilled GRAB offers Keep waiting', async () => {
    const e = expected('unbilled/bca-unbilled-2026-10-10')
    const { user, db } = await setup(mockFetch(aiAnswerFor(e), aiAnswerFor(e), aiAnswerFor(expected('statements/bca-2026-10'))))
    const unbilled = async () => {
      await user.click(screen.getByRole('button', { name: 'Unbilled screenshots' }))
      choose(asFile('unbilled/bca-unbilled-2026-10-10.png'))
      await waitFor(() => expect((screen.getByRole('button', { name: 'Read screenshots' }) as HTMLButtonElement).disabled).toBe(false))
      await user.click(screen.getByRole('button', { name: 'Read screenshots' }))
    }
    await unbilled()
    await user.click(await screen.findByRole('button', { name: 'Save to Unbilled' }))
    expect(await screen.findByText('Saved ✓')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Import another' }))
    await db.meta.clear() // forget the cached answer so the screen reads the capture again
    await unbilled()
    expect(await screen.findAllByText(/Looks like a duplicate:/)).toHaveLength(4)
    expect((screen.getByRole('button', { name: 'Save to Unbilled' }) as HTMLButtonElement).disabled).toBe(true)
    for (const b of screen.getAllByRole('button', { name: 'Skip this one' })) await user.click(b)
    await user.click(screen.getByRole('button', { name: 'Save to Unbilled' }))
    expect(await screen.findByText(/4 skipped as duplicates/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Import another' }))
    await user.click(screen.getByRole('button', { name: 'Statement' }))
    choose(asFile('statements/bca-2026-10.pdf'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    await user.click(await screen.findByRole('button', { name: 'Save statement' }))
    expect(await screen.findByText('Moved from Unbilled')).toBeTruthy()
    expect(screen.getByText(/GRAB\* A-1PENDING JAKARTA PUSATID · 27\.000 was in Unbilled/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }))
    expect(await screen.findByText('OK. It stays in Unbilled for the next statement.')).toBeTruthy()
    expect((await db.transactions.toArray()).find((t) => t.description.includes('PENDING'))!.keepWaiting).toBe(true)
  })

  it('I-12 re-importing the same month warns that it replaces; Cancel goes back; AI errors are shown', async () => {
    const e = expected('statements/bca-2026-10')
    const { user } = await setup(mockFetch(aiAnswerFor(e), '{"rows": "nope"}'))
    const read = async (path: string) => {
      choose(asFile(path))
      await waitFor(() => expect((screen.getByRole('button', { name: 'Read statement' }) as HTMLButtonElement).disabled).toBe(false))
      await user.click(screen.getByRole('button', { name: 'Read statement' }))
    }
    await read('statements/bca-2026-10.pdf')
    await user.click(await screen.findByRole('button', { name: 'Save statement' }))
    await user.click(await screen.findByRole('button', { name: 'Import another' }))
    await read('statements/bca-2026-10.pdf')
    expect(await screen.findByText(/This month is already imported\./)).toBeTruthy()
    expect(screen.getByText(/read before, no new AI request/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await read('statements/bca-2026-11.pdf')
    expect((await screen.findByRole('alert')).textContent).toBe('The AI answer has no list of rows.')
  })

  it('without cards it points to Settings', async () => {
    renderScreen(<ImportPage pdfjs={pdfjs} fetch={mockFetch()} />, { db: freshNewDb() })
    expect(await screen.findByText(/Add a card first/)).toBeTruthy()
  })

  it('reads typed amounts', () => {
    expect(parseTyped('1.234.567')).toBe(1234567)
    expect(parseTyped('Rp 9.000')).toBe(9000)
    expect(parseTyped('')).toBeNull()
    expect(parseTyped('abc')).toBeNull()
  })
})
