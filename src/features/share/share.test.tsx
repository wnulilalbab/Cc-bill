// @vitest-environment jsdom
// Share sheet and /v2/share (docs/test-plan.md S-01..S-06). Synthetic household (fictional), see test/payments/household.ts.
import 'fake-indexeddb/auto'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardBill, ownerBill } from '../../domain/bill'
import { rupiah } from '../../domain/share/format'
import { shareMessage, type ShareContext } from '../../domain/share/message'
import { loadLedger } from '../../data/repo'
import { listShares, logShare } from '../../data/shares'
import { renderScreen } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { BCA_OWNERS, householdLedger, seedHousehold, TODAY } from '../../../test/payments/household'
import { TransactionsPage } from '../transactions/TransactionsPage'
import { localToday, nav, ShareSheet } from './ShareSheet'
import { SharePage } from './SharePage'

const HH = householdLedger()
const OWNERS = BCA_OWNERS.map((name) => ({ id: name, name }))
const NOV = 'bca-2026-11'
const ctx = (extra: Partial<ShareContext> = {}): ShareContext => ({ ledger: HH, card: { name: 'BCA Keluarga' }, owners: OWNERS, statementId: NOV, today: TODAY, ...extra })

const setNavigator = (key: 'share' | 'clipboard', value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true, writable: true })

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setNavigator('share', undefined)
})

const preview = () => screen.getByLabelText('Message preview').textContent

async function openPage() {
  const db = await seedHousehold(freshNewDb())
  const r = renderScreen(<SharePage today={TODAY} />, { db })
  await screen.findByRole('button', { name: "Share Sari's bill" })
  return r
}

async function choose(user: UserEvent, title: string, option: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${title}:`) }))
  const list = screen.getByRole('listbox', { name: title })
  const match = within(list)
    .getAllByRole('option')
    .find((o) => o.firstElementChild?.firstChild?.textContent === option)
  if (!match) throw new Error(`no option "${option}" in ${title}`)
  await user.click(match)
}

describe('/v2/share', () => {
  it('S-01 lists what each person must pay (= ownerBill) and opens one person in Bahasa', async () => {
    const { user } = await openPage()
    const rows = within(screen.getByLabelText('By person'))
    for (const o of BCA_OWNERS) expect(rows.getByText(rupiah(ownerBill(HH, o, NOV, TODAY).mustPay))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: "Share Sari's bill" }))
    const sheet = screen.getByRole('dialog', { name: 'Share preview' })
    expect(within(sheet).getByRole('button', { name: 'Share with: Sari' })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Bahasa' }).getAttribute('aria-pressed')).toBe('true')
    expect(preview()).toBe(shareMessage(ctx(), { ownerId: 'Sari' }).text)
    expect(preview()).toContain(`*Sari: ${rupiah(ownerBill(HH, 'Sari', NOV, TODAY).mustPay)}*`)
  })

  it('S-02 Share all: one block per owner and the card total; language and list switch the text', async () => {
    const { user } = await openPage()
    await user.click(screen.getByRole('button', { name: 'Share to WhatsApp' }))
    expect(preview()).toBe(shareMessage(ctx(), 'all').text)
    expect(preview()).toContain(`*Total semua: ${rupiah(cardBill(HH, BCA_OWNERS, NOV, TODAY).total)}*`)
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(preview()).toBe(shareMessage(ctx({ lang: 'en' }), 'all').text)
    await user.click(screen.getByRole('checkbox', { name: 'Include the list of charges' }))
    expect(preview()).toBe(shareMessage(ctx({ lang: 'en', list: false }), 'all').text)
    await user.click(screen.getByRole('button', { name: 'Bahasa' }))
    await choose(user, 'Share with', 'Medis')
    expect(preview()).toBe(shareMessage(ctx({ list: false }), { ownerId: 'Medis' }).text)
    await choose(user, 'Share with', 'Everyone')
    expect(preview()).toBe(shareMessage(ctx({ list: false }), 'all').text)
  })

  it('S-03 warns before sharing a Draft; a Final statement has no warning', async () => {
    const { user } = await openPage()
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    expect(within(screen.getByLabelText('Draft warning')).getByText(/marked "sementara"/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(within(screen.getByLabelText('Draft warning')).getByText(/marked "provisional"/)).toBeTruthy()
    await user.keyboard('{Escape}')
    await choose(user, 'Statement', 'Jul 2026 statement')
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    expect(screen.queryByLabelText('Draft warning')).toBeNull()
    expect(preview()).not.toContain('SEMENTARA')
  })

  it('shows "Paid ✓" for a settled person and a row for charges without an owner', async () => {
    const db = await seedHousehold(freshNewDb())
    await db.transactions.put({ id: 'x-none', cardId: 'bca', statementId: 'bca-2026-07', date: '2026-07-01', description: 'TOKO X', amount: 12_000, kind: 'purchase', ownerId: null })
    const { user } = renderScreen(<SharePage today={TODAY} />, { db })
    await screen.findByRole('button', { name: "Share Sari's bill" })
    await choose(user, 'Statement', 'Jul 2026 statement')
    const rows = within(screen.getByLabelText('By person'))
    expect(rows.getAllByText('Paid ✓')).toHaveLength(5)
    expect(rows.getByText('No owner')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: "Share No owner's bill" }))
    expect(preview()).toContain('*Tanpa pemilik: Rp 12.000*')
    await choose(user, 'Share with', 'Everyone')
    await choose(user, 'Share with', 'No owner')
    expect(screen.getByRole('button', { name: 'Share with: No owner' })).toBeTruthy()
  })

  it('without a card it asks for one', async () => {
    renderScreen(<SharePage today={TODAY} />)
    expect(await screen.findByText('Add a card in Settings first.')).toBeTruthy()
  })
})

describe('sending', () => {
  it('Send via WhatsApp opens wa.me with the encoded text and logs the share (S-05)', async () => {
    const { user, db } = await openPage()
    const tab = { opener: {} }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    await user.click(screen.getByRole('button', { name: "Share Andi's bill" }))
    const text = preview()!
    await user.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect(open).toHaveBeenCalledTimes(1)
    const [url, name] = open.mock.calls[0] as [string, string]
    expect(name).toBe('_blank')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(new URL(url).searchParams.get('text')).toBe(text)
    expect(tab.opener).toBeNull()
    const andi = ownerBill(HH, 'Andi', NOV, TODAY).mustPay
    await waitFor(async () => expect(await listShares(db, 'bca', NOV)).toEqual([{ target: { ownerId: 'Andi' }, total: andi, date: TODAY }]))
    const sent = await screen.findByLabelText('Sent before')
    expect(within(sent).getByText(/1 Nov 2026 · Andi/)).toBeTruthy()
    expect(within(sent).getByText(rupiah(andi))).toBeTruthy()
    expect(within(sent).queryByText(/now/)).toBeNull()
  })

  it('falls back to the WhatsApp app when the browser blocks the new tab', async () => {
    const { user } = await openPage()
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    await user.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    const url = assign.mock.calls[0][0]
    expect(url.startsWith('whatsapp://send?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('whatsapp://send?text='.length))).toBe(preview())
  })

  it('S-05 "Sent before" shows the amount sent and "now X" when it changed', async () => {
    const db = await seedHousehold(freshNewDb())
    await logShare(db, 'bca', NOV, { target: { ownerId: 'Sari' }, total: 1_049_367, date: '2026-10-20' })
    await logShare(db, 'bca', NOV, { target: { ownerId: 'Bima' }, total: 535_000, date: '2026-10-21' })
    await logShare(db, 'bca', NOV, { target: 'all', total: 1, date: '2026-10-22' })
    await logShare(db, 'bca', NOV, { target: { ownerId: 'Gone' }, total: 7, date: '2026-10-23' })
    const { user } = renderScreen(<SharePage today={TODAY} />, { db })
    await user.click(await screen.findByRole('button', { name: "Share Sari's bill" }))
    const sent = await screen.findByLabelText('Sent before')
    expect(within(sent).getByText(/20 Oct 2026 · Sari/)).toBeTruthy()
    expect(within(sent).getByText(/now Rp 928\.734/)).toBeTruthy()
    expect(within(sent).queryByText(/Bima/)).toBeNull()
    await choose(user, 'Share with', 'Everyone')
    const all = screen.getByLabelText('Sent before')
    expect(within(all).getByText(/21 Oct 2026 · Bima/)).toBeTruthy()
    expect(within(all).getByText(/22 Oct 2026 · Everyone/)).toBeTruthy()
    expect(within(all).getByText(`now ${rupiah(cardBill(HH, BCA_OWNERS, NOV, TODAY).total)}`, { exact: false })).toBeTruthy()
    expect(within(all).getByText(/23 Oct 2026 · Unknown/)).toBeTruthy()
    expect(within(all).getByText(/now Rp 0/)).toBeTruthy()
  })

  it('Share… uses the phone share sheet when there is one; closing it logs nothing', async () => {
    const { user, db } = await openPage()
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' })).mockRejectedValueOnce(new Error('denied'))
    setNavigator('share', share)
    await user.click(screen.getByRole('button', { name: "Share Medis's bill" }))
    await user.click(screen.getByRole('button', { name: 'Share…' }))
    expect(share).toHaveBeenCalledWith({ text: preview() })
    await waitFor(async () => expect(await listShares(db, 'bca', NOV)).toHaveLength(1))
    await user.click(screen.getByRole('checkbox', { name: 'Include the list of charges' }))
    await user.click(screen.getByRole('button', { name: 'Share…' }))
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Share…' }))
    expect((await screen.findByRole('status')).textContent).toBe('Could not share: denied')
    expect(await listShares(db, 'bca', NOV)).toHaveLength(1)
  })

  it('Share… is hidden when the browser cannot share', async () => {
    const { user } = await openPage()
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    expect(screen.queryByRole('button', { name: 'Share…' })).toBeNull()
  })

  it('S-06 Copy puts exactly the previewed text on the clipboard', async () => {
    const { user, db } = await openPage()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator('clipboard', { writeText })
    await user.click(screen.getByRole('button', { name: "Share Keluarga's bill" }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(preview())
    expect(writeText.mock.calls[0][0]).toBe(shareMessage(ctx(), { ownerId: 'Keluarga' }).text)
    expect((await screen.findByRole('status')).textContent).toBe('Copied. Paste it in WhatsApp.')
    await waitFor(async () => expect(await listShares(db, 'bca', NOV)).toHaveLength(1))
  })

  it('when the clipboard refuses, the text is shown selected to copy by hand', async () => {
    const { user } = await openPage()
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('no')) })
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    const box = (await screen.findByRole('textbox', { name: 'Message text' })) as HTMLTextAreaElement
    expect(box.value).toBe(preview())
    expect(box.selectionEnd - box.selectionStart).toBe(box.value.length)
    expect(screen.getByRole('status').textContent).toBe('Select the text and copy it')
  })

  it('a share that cannot be logged still goes out and says so', async () => {
    const { user, db } = await openPage()
    vi.spyOn(window, 'open').mockReturnValue({} as Window)
    vi.spyOn(db.meta, 'put').mockRejectedValue(new Error('disk full'))
    await user.click(screen.getByRole('button', { name: 'Share all' }))
    await user.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect((await screen.findByRole('status')).textContent).toBe('Shared, but could not log it: disk full')
  })
})

describe('entry points', () => {
  it('Transactions has a Share button that opens the sheet for the selected statement', async () => {
    const db = await seedHousehold(freshNewDb())
    const { user } = renderScreen(<TransactionsPage />, { db })
    await user.click(await screen.findByRole('button', { name: 'Share' }))
    const ledger = await loadLedger(db, 'bca')
    expect(screen.getByRole('button', { name: 'Share with: Everyone' })).toBeTruthy()
    expect(preview()).toBe(shareMessage({ ...ctx(), ledger, today: localToday() }, 'all').text)
  })

  it('the sheet can be used on its own, defaulting to everyone and today', async () => {
    const onClose = vi.fn()
    const { user } = renderScreen(<ShareSheet ledger={HH} card={{ id: 'bca', name: 'BCA Keluarga' }} owners={[{ ...OWNERS[0], cardId: 'bca', archived: true }, ...OWNERS.slice(1).map((o) => ({ ...o, cardId: 'bca' }))]} statementId="bca-unb" onClose={onClose} />)
    expect(screen.getByText('BCA Keluarga · Unbilled')).toBeTruthy()
    expect(preview()!.split('\n')[1]).toMatch(/^Per \d+ \w+ \d{4}$/)
    await user.click(screen.getByRole('button', { name: 'Share with: Everyone' }))
    expect(within(screen.getByRole('listbox', { name: 'Share with' })).getByText('Archived')).toBeTruthy()
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('localToday is the local calendar date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localToday(new Date(2026, 10, 30, 0, 1))).toBe('2026-11-30')
  })
})
