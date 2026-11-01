// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardBill, ownerBill, type OwnerBill } from '../../domain/bill'
import { draftIssues } from '../../domain/draft'
import { sum } from '../../domain/money'
import { billedOf, latestBilled } from '../../domain/statements'
import type { Ledger, Payment, Transaction } from '../../domain/types'
import { saveCard, unbilledIdOf } from '../../data/cards'
import type { NewDb } from '../../data/db'
import { loadLedger } from '../../data/repo'
import { markReviewed } from '../../data/transactions'
import { renderRoutes, token, settle } from '../../test-utils/ui'
import { freshNewDb } from '../../../test/data/oldDb'
import { assignAll, seedHousehold, tagAsExpected } from '../../../test/bill/household'
import type { Seeded } from '../../../test/import/helpers'
import householdFixture from '../../../test/fixtures/household.json'
import { PREF_KEYS, prefSet } from '../look/prefs'
import { rp } from '../settings/format'
import { PaymentsRoutes } from '../payments/PaymentsRoutes'
import { TransactionsPage } from '../transactions/TransactionsPage'
import { fmt } from '../transactions/view'
import { BillPage, NO_OWNER, personPath } from './BillPage'
import { PersonPage } from './PersonPage'
import { todayIso } from './useBill'
import { groupByKind, hasSomething, monthName, personPayments } from './view'

// Synthetic household (fictional "Andi Pratama", test/fixtures): BCA Keluarga Jul–Nov and Mandiri Pribadi Aug–Nov,
// imported through the real import path, rows tagged with each fixture's expected owner.

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(async () => {
  await settle() // the last action's reads finish inside the test, on every run
  cleanup()
  vi.unstubAllGlobals()
})

const ROUTES = {
  '/bill': <BillPage />,
  '/bill/person/:ownerId': <PersonPage />,
  '/transactions': <TransactionsPage />,
  '/payments/*': <PaymentsRoutes />,
}

async function household(): Promise<{ db: NewDb; cards: Seeded }> {
  const db = freshNewDb()
  const cards = await seedHousehold(db)
  await tagAsExpected(db, cards)
  return { db, cards }
}

/** Opens Bill on `card` (selected card pref) and waits for the hero. */
async function openBill(db: NewDb, cardId: string, at = '/bill') {
  prefSet(PREF_KEYS.selectedCard, cardId)
  const r = renderRoutes(ROUTES, at, { db })
  await screen.findByLabelText('To pay')
  return r
}

const ownerIds = (cards: Seeded, key: 'bca' | 'mandiri') => Object.values(cards.owners[key])
const nameOf = (cards: Seeded, key: 'bca' | 'mandiri', id: string | null) => Object.entries(cards.owners[key]).find(([, v]) => v === id)?.[0] ?? 'No owner'

async function domain(db: NewDb, cards: Seeded, key: 'bca' | 'mandiri', statementId?: string) {
  const l = await loadLedger(db, cards[key])
  const s = statementId ?? latestBilled(l, cards[key])!.id
  return { l, s, cb: cardBill(l, ownerIds(cards, key), s, todayIso()), bill: (owner: string) => ownerBill(l, cards.owners[key][owner], s, todayIso()) }
}

const hero = () => screen.getByLabelText('To pay')
const big = () => hero().querySelector('.big')!.textContent
/** Hero lines as label → value. */
const heroLines = (root: HTMLElement = hero()) => Object.fromEntries(Array.from(root.querySelectorAll('.line')).map((l) => [l.children[0].textContent, l.children[1].textContent]))
/** "1.234.567" / "− 1.234" / "+ 5" → signed number. */
const num = (text: string | null | undefined) => {
  const t = (text ?? '').trim()
  const n = Number(t.replace(/^[−+-]\s*/, '').replace(/\./g, '').replace(/^Rp\s*/, ''))
  return n === 0 ? 0 : t.startsWith('−') || t.startsWith('-') ? -n : n
}
const location = () => screen.getByTestId('location').textContent
const ownerRow = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}: `) })
const rowKv = (name: string) => {
  const spans = Array.from(ownerRow(name).querySelectorAll('.kv > span'))
  const out: Record<string, string> = {}
  for (let i = 0; i < spans.length; i += 2) out[spans[i].textContent!] = spans[i + 1].textContent!
  return out
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

/** The hero equals the domain cardBill (sum of ownerBill) and its lines add up to the total. */
function expectHero(cb: ReturnType<typeof cardBill>, chargesLabel: string) {
  const charges = sum(cb.owners.map((o) => o.charges))
  const paid = sum(cb.owners.map((o) => o.alreadyPaid))
  const older = sum(cb.owners.map((o) => o.olderRemaining))
  const credit = sum(cb.owners.map((o) => o.credit))
  expect(big()).toBe(cb.total ? rp(cb.total) : 'Paid ✓')
  const lines = heroLines()
  expect(num(lines[chargesLabel])).toBe(charges)
  expect(num(lines['Already paid'])).toBe(0 - paid)
  expect(num(lines['Left on these charges'])).toBe(charges - paid)
  expect(num(lines['Still unpaid from older bills'])).toBe(older)
  expect(lines['Credit carried forward (refunds larger than charges)'] ? num(lines['Credit carried forward (refunds larger than charges)']) : 0).toBe(credit)
  // M-10 to the rupiah: charges − already paid + older unpaid (+ credit kept for its owner) = total.
  expect(charges - paid + older + credit).toBe(cb.total)
  expect(num(lines[chargesLabel]) + num(lines['Already paid']) + num(lines['Still unpaid from older bills']) + credit).toBe(cb.total)
}

function expectOwnerRows(cb: ReturnType<typeof cardBill>, cards: Seeded, key: 'bca' | 'mandiri') {
  const shown = cb.owners.filter(hasSomething)
  expect(screen.getAllByRole('link').filter((a) => a.classList.contains('orow'))).toHaveLength(shown.length)
  for (const b of shown) {
    const name = nameOf(cards, key, b.ownerId)
    expect(ownerRow(name).getAttribute('aria-label')).toBe(`${name}: ${b.settled ? 'Paid' : rp(b.mustPay)}`)
    const kv = rowKv(name)
    expect(num(Object.entries(kv).find(([k]) => k.endsWith(' charges'))![1])).toBe(b.charges)
    expect(num(kv.Left)).toBe(b.thisRemaining)
    expect(kv['Already paid'] ? 0 - num(kv["Already paid"]) : 0).toBe(b.alreadyPaid)
    expect(Object.entries(kv).find(([k]) => k.startsWith('Unpaid from'))?.[1] ?? '0').toBe(b.olderRemaining ? `${b.olderRemaining < 0 ? '−' : '+'} ${fmt(Math.abs(b.olderRemaining))}` : '0')
    expect(kv.Credit ? num(kv.Credit) : 0).toBe(b.credit)
    expect(kv['Deposit left'] ? num(kv['Deposit left']) : 0).toBe(b.depositWaiting)
  }
}

describe('Bill screen (fixture household)', () => {
  it('M-09 M-10 card totals equal the bank balance when every payment is assigned; hero and per-person numbers equal the domain', async () => {
    const { db, cards } = await household()
    expect(await assignAll(db, cards.bca)).toBe(0)
    expect(await assignAll(db, cards.mandiri)).toBe(0)
    const bca = await domain(db, cards, 'bca')
    const mandiri = await domain(db, cards, 'mandiri')
    // The bank's printed new balance of the latest statements.
    expect(bca.cb.total).toBe(1_625_380)
    expect(mandiri.cb.total).toBe(348_133)

    await openBill(db, cards.bca)
    expect(screen.getByRole('button', { name: 'Statement: Nov 2026 statement' })).toBeTruthy()
    expect(screen.getByText('Due 28 Nov 2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: `BCA Keluarga ${rp(1_625_380)}` }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: `Mandiri Pribadi ${rp(348_133)}` }).getAttribute('aria-pressed')).toBe('false')
    expect(hero().querySelector('.sub')!.textContent).toBe('To pay for the Nov 2026 bill')
    expectHero(bca.cb, 'Nov 2026 charges')
    expectOwnerRows(bca.cb, cards, 'bca')
    // M-09: the tile total is the sum of the owners' bills.
    expect(sum(bca.cb.owners.map((o) => o.mustPay))).toBe(1_625_380)
  })

  it('switching cards shows that card\'s latest bill; the hero follows the domain', async () => {
    const { db, cards } = await household()
    const { user } = await openBill(db, cards.bca)
    await user.click(screen.getByRole('button', { name: /^Mandiri Pribadi / }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Mandiri Pribadi / }).getAttribute('aria-pressed')).toBe('true'))
    const m = await domain(db, cards, 'mandiri')
    await waitFor(() => expect(big()).toBe(rp(m.cb.total)))
    expect(screen.getByText('Due 30 Nov 2026')).toBeTruthy()
    expectHero(m.cb, 'Nov 2026 charges')
    expectOwnerRows(m.cb, cards, 'mandiri')
  })

  it('M-01 older unpaid bills are added and listed per month; the statement picker changes the bill', async () => {
    const { db, cards } = await household()
    const { user } = await openBill(db, cards.bca)
    await choose(user, 'Statement', 'Oct 2026 statement')
    await waitFor(() => expect(hero().querySelector('.sub')!.textContent).toBe('To pay for the Oct 2026 bill'))
    expect(location()).toMatch(/\?s=/)
    const oct = await domain(db, cards, 'bca', (await loadLedger(db, cards.bca)).statements.find((s) => s.kind === 'billed' && s.statementDate === '2026-10-12')!.id)
    expectHero(oct.cb, 'Oct 2026 charges')
    expectOwnerRows(oct.cb, cards, 'bca')
    // Andi: Oct charges plus what is still unpaid from Sep, Aug and Jul (nothing assigned yet).
    const andi = oct.bill('Andi')
    expect(andi.older.map((g) => g.statement.statementDate)).toEqual(['2026-09-12', '2026-08-12', '2026-07-12'])
    expect(andi.mustPay).toBe(andi.charges + andi.olderRemaining)
    expect(rowKv('Andi')['Unpaid from Sep, Aug, Jul']).toBe(`+ ${fmt(andi.olderRemaining)}`)
  })

  it('M-08 Unbilled shows unbilled charges plus older billed ones still unpaid', async () => {
    const { db, cards } = await household()
    const andi = cards.owners.bca.Andi
    await db.transactions.put(tx(cards.bca, unbilledIdOf(cards.bca), 'u1', '2026-11-15', 'GRAB* A-UNB', 50_000, andi))
    const { user } = await openBill(db, cards.bca)
    await choose(user, 'Statement', 'Unbilled')
    await waitFor(() => expect(hero().querySelector('.sub')!.textContent).toBe('Open now, incl. older bills'))
    expect(screen.getByText('Not billed yet')).toBeTruthy()
    const u = await domain(db, cards, 'bca', unbilledIdOf(cards.bca))
    expect(u.bill('Andi').charges).toBe(50_000)
    expect(u.bill('Andi').older.length).toBeGreaterThan(0)
    expectHero(u.cb, 'Unbilled charges')
    expectOwnerRows(u.cb, cards, 'bca')
  })
})

/** A synthetic row on a card. */
function tx(cardId: string, statementId: string, id: string, date: string, description: string, amount: number, ownerId: string | null, extra: Partial<Transaction> = {}): Transaction {
  return { id, cardId, statementId, date, description, amount, kind: amount < 0 ? 'refund' : 'purchase', ownerId, tagSource: 'manual', ...extra }
}

const groupTotals = () =>
  Array.from(document.querySelectorAll('section.box'))
    .filter((s) => ['Purchases', 'Installments', 'Fees and interest', 'Refunds', 'Not counted'].includes(s.getAttribute('aria-label') ?? ''))
    .map((s) => [s.getAttribute('aria-label'), num(s.querySelector('.row .num')!.textContent)] as const)

describe('person detail', () => {
  it('M-10 the lines add up to the hero: kind groups = charges; payments + deposit = already paid; + older = to pay', async () => {
    const { db, cards } = await household()
    await assignAll(db, cards.bca)
    const { user } = await openBill(db, cards.bca)
    const d = await domain(db, cards, 'bca')
    for (const name of ['Andi', 'Sari', 'Keluarga']) {
      const b = d.bill(name)
      await user.click(ownerRow(name))
      await screen.findByRole('heading', { name })
      expect(location()).toBe(`/bill/person/${cards.owners.bca[name]}?s=${d.s}`)
      expect(big()).toBe(b.settled ? 'Paid ✓' : rp(b.mustPay))
      expect(num(heroLines()['Nov 2026 charges'])).toBe(b.charges)
      expect(num(heroLines()['Already paid'])).toBe(0 - b.alreadyPaid)
      expect(num(heroLines()['Still unpaid from older bills'])).toBe(b.olderRemaining)
      expect(b.charges - b.alreadyPaid + b.olderRemaining + b.credit).toBe(b.mustPay)

      // Groups by kind add up to this statement's charges.
      const groups = groupTotals()
      expect(groups).toEqual(groupByKind(b.lines).map((g) => [{ purchase: 'Purchases', installment: 'Installments', feeInterest: 'Fees and interest', refund: 'Refunds', notCounted: 'Not counted' }[g.kind], g.total]))
      expect(sum(groups.map(([, v]) => v))).toBe(b.charges)

      // The payments behind "Already paid".
      const box = screen.getByLabelText('Payments for this bill')
      const rows = Array.from(box.querySelectorAll('.row.small')).map((r) => num(r.querySelector('.num')!.textContent))
      expect(rows.at(-1)).toBe(0 - b.alreadyPaid)
      expect(sum(rows.slice(0, -1))).toBe(0 - b.alreadyPaid)
      const pp = personPayments(d.l, b)
      expect(sum(pp.payments.map((p) => p.amount)) + pp.fromDeposit).toBe(b.alreadyPaid)

      // Older unpaid groups add up to the older line.
      const older = b.older.map((g) => {
        const text = screen.getByLabelText(`${monthName(g.statement)} statement`).querySelector('.row .num')!.textContent!
        return text.startsWith('Credit ') ? -num(text.slice(7)) : num(text)
      })
      if (b.older.length) expect(sum(older)).toBe(b.olderRemaining)
      await user.click(screen.getByRole('button', { name: 'Back' }))
      await screen.findByRole('heading', { name: 'Bill' })
    }
  })

  it('M-03 M-04 installments still to come are a snapshot per statement (Blibli 6 months: 5 left on Oct, 4 on Nov)', async () => {
    const { db, cards } = await household()
    const l = await loadLedger(db, cards.bca)
    const [, , , oct, nov] = billedOf(l, cards.bca)
    const sari = cards.owners.bca.Sari
    const plan = l.plans.find((p) => p.name.toLowerCase().includes('blibli') || p.monthly === 729_367)!
    expect(plan).toMatchObject({ monthly: 729_367, total: 6, ownerId: sari })

    renderRoutes(ROUTES, `/bill/person/${sari}?s=${oct.id}`, { db })
    const box = await screen.findByLabelText('Installments still to come')
    expect(within(box).getByText(/5 months left × 729\.367/)).toBeTruthy()
    expect(within(box).getByText(fmt(5 * 729_367))).toBeTruthy()
    expect(fmt(5 * 729_367)).toBe('3.646.835')
    expect(ownerBill(l, sari, oct.id, todayIso()).installmentsToCome.find((f) => f.planId === plan.id)!.amount).toBe(3_646_835)
    cleanup()

    renderRoutes(ROUTES, `/bill/person/${sari}?s=${nov.id}`, { db })
    const box2 = await screen.findByLabelText('Installments still to come')
    expect(within(box2).getByText(/4 months left × 729\.367/)).toBeTruthy()
    expect(within(box2).getByText(fmt(4 * 729_367))).toBeTruthy()
  })

  it('M-02 a payment dated after the due date lowers the bill (live) and its charge shows "after due"', async () => {
    const { db, cards } = await household()
    const l = await loadLedger(db, cards.bca)
    const oct = billedOf(l, cards.bca)[3]
    const rs = l.transactions.find((t) => t.description === 'RS PONDOK INDAH' && t.statementId === oct.id)!
    const late = l.payments.find((p) => p.date === '2026-10-30')!
    const medis = cards.owners.bca.Medis
    const before = ownerBill(l, medis, oct.id, todayIso())
    await db.payments.put({ ...late, allocations: [{ txId: rs.id, amount: 1_150_000 }] })
    const after = ownerBill(await loadLedger(db, cards.bca), medis, oct.id, todayIso())
    // Live: the Oct bill (net of any carried credit) drops by what the late payment paid.
    expect(before.mustPay - before.credit - (after.mustPay - after.credit)).toBe(1_150_000)

    renderRoutes(ROUTES, `/bill/person/${medis}?s=${oct.id}`, { db })
    await screen.findByRole('heading', { name: 'Medis' })
    expect(big()).toBe(after.settled ? 'Paid ✓' : rp(after.mustPay))
    const row = screen.getByLabelText('RS PONDOK INDAH 1.150.000')
    expect(within(row).getByText('after due')).toBeTruthy()
    expect(within(row).getByText('Paid')).toBeTruthy()
    const pays = screen.getByLabelText('Payments for this bill')
    expect(within(pays).getByText(/30 Oct 2026 · PEMBAYARAN/)).toBeTruthy()
    expect(within(pays).getByText('after due')).toBeTruthy()
    // Each payment opens its assign page (Slice 9).
    expect(within(pays).getByRole('link', { name: /30 Oct 2026 · PEMBAYARAN/ }).getAttribute('href')).toBe(`/payments/${late.id}`)
  })

  it('M-05 a refund lowers the owner\'s charges and shows as Refund; M-06 reversal and moved purchase count 0', async () => {
    const { db, cards } = await household()
    const m = await domain(db, cards, 'mandiri', (await loadLedger(db, cards.mandiri)).statements.find((s) => s.kind === 'billed' && s.statementDate === '2026-10-11')!.id)
    const rumah = cards.owners.mandiri.Rumah
    renderRoutes(ROUTES, `/bill/person/${rumah}?s=${m.s}`, { db })
    await screen.findByRole('heading', { name: 'Rumah' })
    const refunds = screen.getByLabelText('Refunds')
    expect(within(refunds).getByText('Refund')).toBeTruthy()
    expect(within(refunds).getAllByText('−44.631').length).toBeGreaterThan(0)
    expect(m.bill('Rumah').charges).toBe(283_000 + 44_631 - 44_631)
    expect(num(heroLines()['Oct 2026 charges'])).toBe(283_000)
    cleanup()

    // BCA Oct: the Blibli reversal is Sari's and not counted; Sep's moved purchase is not counted either.
    const b = await loadLedger(db, cards.bca)
    const [, , sep, oct] = billedOf(b, cards.bca)
    renderRoutes(ROUTES, `/bill/person/${cards.owners.bca.Sari}?s=${oct.id}`, { db })
    await screen.findByRole('heading', { name: 'Sari' })
    const dead = screen.getByLabelText('Not counted')
    expect(within(dead).getAllByText('Not counted')).toHaveLength(2)
    expect(within(dead).getByText('Reversal')).toBeTruthy()
    expect(groupTotals().find(([k]) => k === 'Not counted')![1]).toBe(0)
    const moved = b.transactions.find((t) => t.cancelled)!
    expect(moved.statementId).toBe(sep.id)
  })

  it('credit: refunds larger than charges show as the owner\'s credit, not taken off anyone else (M-11 "Paid ✓")', async () => {
    const { db, cards } = await household()
    await assignAll(db, cards.mandiri)
    const l = await loadLedger(db, cards.mandiri)
    const nov = latestBilled(l, cards.mandiri)!
    const kantor = cards.owners.mandiri.Kantor
    await db.transactions.put(tx(cards.mandiri, nov.id, 'big-refund', '2026-11-05', 'REFUND OFFICE CHAIR', -500_000, kantor))
    const d = await domain(db, cards, 'mandiri')
    const k = d.bill('Kantor')
    expect(k.credit).toBeGreaterThan(0)
    expect(k.mustPay).toBe(0)

    const { user } = await openBill(db, cards.mandiri)
    expectHero(d.cb, 'Nov 2026 charges')
    expectOwnerRows(d.cb, cards, 'mandiri')
    expect(within(ownerRow('Kantor')).getByText('Paid ✓')).toBeTruthy()
    expect(rowKv('Kantor').Credit).toBe(fmt(k.credit))
    // M-09: the card total is above the bank balance by the credit; the hero says why.
    expect(d.cb.total - k.credit).toBe(sum(d.cb.owners.map((o) => o.mustPay - o.credit)))
    expect(screen.getByLabelText('Credit hint').textContent).toBe(
      `This total is ${rp(k.credit)} above what the bank shows: that is a refund credit kept for its owner, not taken off anyone else's bill.`,
    )
    // The card total is the others' bills; Kantor's credit does not lower them.
    expect(d.cb.total).toBe(sum(d.cb.owners.filter((o) => o.ownerId !== kantor).map((o) => o.mustPay)))

    await user.click(ownerRow('Kantor'))
    await screen.findByRole('heading', { name: 'Kantor' })
    expect(big()).toBe('Paid ✓')
    expect(within(screen.getByLabelText('Credit')).getByText(`Credit ${rp(k.credit)}`)).toBeTruthy()
  })

  it('D-01 D-05 a deposit pays later charges ("from deposit"), shows what is left, then "used, 0 left" and the hero line hides', async () => {
    const { db, cards } = await household()
    const l = await loadLedger(db, cards.bca)
    const nov = latestBilled(l, cards.bca)!
    const sari = cards.owners.bca.Sari
    const line = l.payments.find((p) => p.date === '2026-10-30')!
    await db.payments.put({ ...line, depositOwnerId: sari })
    await db.transactions.put(tx(cards.bca, nov.id, 'dep1', '2026-11-03', 'WATSONS PIM', 320_000, sari))

    renderRoutes(ROUTES, `/bill/person/${sari}?s=${nov.id}`, { db })
    await screen.findByRole('heading', { name: 'Sari' })
    expect(heroLines()['Deposit waiting for new charges']).toBe('1.180.000')
    const deposits = screen.getByLabelText('Deposits')
    expect(within(deposits).getByText('1.180.000 left')).toBeTruthy()
    expect(within(deposits).getByText(/used 320\.000/)).toBeTruthy()
    const row = screen.getByLabelText('WATSONS PIM 320.000')
    expect(within(row).getByText('From deposit 320.000')).toBeTruthy()
    expect(within(screen.getByLabelText('Payments for this bill')).getByText(/From Sari's deposit/)).toBeTruthy()

    await db.transactions.put(tx(cards.bca, nov.id, 'dep2', '2026-11-05', 'IKEA ALAM SUTERA', 1_180_000, sari))
    await waitFor(() => expect(within(screen.getByLabelText('Deposits')).getByText('used, 0 left')).toBeTruthy())
    expect(heroLines()['Deposit waiting for new charges']).toBeUndefined()
    const b = ownerBill(await loadLedger(db, cards.bca), sari, nov.id, todayIso())
    expect(b.depositWaiting).toBe(0)
    expect(num(heroLines()['Already paid'])).toBe(0 - b.alreadyPaid)
  })

  it('person links encode the owner id; "No owner" uses a sentinel that cannot be a real id', async () => {
    expect(personPath('own er/1?x', 's 1')).toBe('/bill/person/own%20er%2F1%3Fx?s=s%201')
    expect(personPath(null, 'oct')).toBe(`/bill/person/${NO_OWNER}?s=oct`)
    expect(NO_OWNER).toBe('_none')
    const db = freshNewDb()
    const cardId = await saveCard(db, { name: 'Kartu Aneh', bank: 'BNI', last4: '0003', statementDay: '12', palette: 'blue', owners: [{ name: 'Andi', color: '#000' }], defaultIndex: 0 })
    await db.owners.put({ id: 'odd/id?#1', cardId, name: 'Odd' })
    await db.statements.put({ id: 'odd-oct', cardId, kind: 'billed', statementDate: '2026-10-12', dueDate: '2026-10-28', printed: { prevBalance: 0, credits: 0, purchases: 5_000, feesInterest: 0, newBalance: 5_000 } })
    await db.transactions.put(tx(cardId, 'odd-oct', 'o1', '2026-10-03', 'KOPI', 5_000, 'odd/id?#1'))
    const { user } = await openBill(db, cardId)
    await user.click(ownerRow('Odd'))
    expect(await screen.findByRole('heading', { name: 'Odd' })).toBeTruthy()
    expect(big()).toBe(rp(5_000))
  })

  it('an unknown person says so; "No owner" rows have their own detail; Open Payments links to /payments', async () => {
    const { db, cards } = await household()
    const l = await loadLedger(db, cards.bca)
    const nov = latestBilled(l, cards.bca)!
    await db.transactions.put(tx(cards.bca, nov.id, 'orphan', '2026-11-02', 'KOPI KENANGAN', 30_000, null))
    const { user } = await openBill(db, cards.bca)
    await user.click(ownerRow('No owner'))
    await screen.findByRole('heading', { name: 'No owner' })
    expect(location()).toBe(`/bill/person/_none?s=${nov.id}`)
    expect(big()).toBe(rp(30_000))
    await user.click(screen.getByRole('link', { name: 'Open Payments' }))
    expect(location()).toBe('/payments')
    cleanup()

    const r = renderRoutes(ROUTES, `/bill/person/${cards.owners.bca.Andi}?s=${nov.id}`, { db })
    await screen.findByRole('heading', { name: 'Andi' })
    await r.user.click(screen.getByRole('link', { name: 'Open Payments' }))
    expect(location()).toBe('/payments')
    cleanup()

    // "none" is a readable alias of the "_none" sentinel.
    renderRoutes(ROUTES, `/bill/person/none?s=${nov.id}`, { db })
    expect(await screen.findByRole('heading', { name: 'No owner' })).toBeTruthy()
    expect(big()).toBe(rp(30_000))
    cleanup()

    renderRoutes(ROUTES, `/bill/person/nobody?s=${nov.id}`, { db })
    expect(await screen.findByText('This person is not on the BCA Keluarga card.')).toBeTruthy()
  })
})

describe('Draft / Final on Bill', () => {
  it('F-01 F-02 Check rows and unassigned bank payments keep it Draft, each with its jump link', async () => {
    const { db, cards } = await household()
    const d = await domain(db, cards, 'bca')
    const issues = draftIssues(d.l, d.s)
    expect(issues.checkRows).toHaveLength(1)
    expect(issues.blockingPayments).toHaveLength(2)
    const { user } = await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText(`Draft · ${issues.count} to finish`)).toBeTruthy()
    expect(within(panel).getByText('1 row needs a check')).toBeTruthy()
    expect(within(panel).getByText('2 payments not assigned (Rp 3.500.000)')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Assign' }).getAttribute('href')).toBe(`/payments/${issues.blockingPayments[0]}`)
    await user.click(within(panel).getByRole('link', { name: 'Review' }))
    expect(location()).toBe(`/transactions?statement=${d.s}&status=check`)
    // Transactions opens on that statement with the Needs check filter.
    expect(await screen.findByRole('button', { name: 'Status: Needs check' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Statement: Nov 2026 statement' })).toBeTruthy()
  })

  it('F-03 an Unbilled payment line after the statement does not block it; F-05 a deposit does not block; F-06 Decide later does', async () => {
    const { db, cards } = await household()
    const unb = unbilledIdOf(cards.bca)
    const pay = (id: string, extra: Partial<Payment>): Payment => ({ id, cardId: cards.bca, source: 'unbilled', statementId: unb, date: '2026-11-15', amount: 100_000, allocations: [], ...extra })
    await db.payments.put(pay('u-pay', {}))
    let d = await domain(db, cards, 'bca')
    expect(draftIssues(d.l, d.s).blockingPayments).toHaveLength(2)

    const l = d.l
    const [a, b] = draftIssues(l, d.s).blockingPayments.map((id) => l.payments.find((p) => p.id === id)!)
    await db.payments.put({ ...a, depositOwnerId: cards.owners.bca.Andi })
    d = await domain(db, cards, 'bca')
    expect(draftIssues(d.l, d.s).blockingPayments).toEqual([b.id])
    await openBill(db, cards.bca)
    expect(within(screen.getByLabelText('Draft or Final')).getByText(`1 payment not assigned (${rp(b.amount)})`)).toBeTruthy()
  })

  it('F-04 F-07 a hand-recorded payment that is on no statement blocks with "isn\'t on a statement"', async () => {
    const { db, cards } = await household()
    const bima = householdFixture.handRecorded.payments[0]
    await db.payments.put({ id: 'hand-bima', cardId: cards.bca, source: 'manual', date: bima.date, amount: bima.amount, allocations: [], forOwnerIds: [cards.owners.bca.Bima] })
    const d = await domain(db, cards, 'bca')
    expect(draftIssues(d.l, d.s).missingPayments).toEqual(['hand-bima'])
    const { user } = await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText("1 payment you recorded isn't on a statement")).toBeTruthy()
    expect(within(panel).getAllByRole('link', { name: 'Resolve' })[0].getAttribute('href')).toBe('/payments/hand-bima')
    // The Assign link opens that payment's full-screen assign page (Slice 9).
    const assign = within(panel).getByRole('link', { name: 'Assign' })
    const target = assign.getAttribute('href')!
    await user.click(assign)
    expect(location()).toBe(target)
    expect(await screen.findByLabelText('Left to assign')).toBeTruthy()
  })

  it('F-08 an Unbilled row dated before the latest statement blocks the latest statement only; Resolve opens the row', async () => {
    const { db, cards } = await household()
    const unb = unbilledIdOf(cards.bca)
    await db.transactions.put(tx(cards.bca, unb, 'ghost', '2026-11-09', 'GRAB* A-1PENDING', 27_000, cards.owners.bca.Andi))
    const d = await domain(db, cards, 'bca')
    expect(draftIssues(d.l, d.s).notOnStatementRows).toEqual(['ghost'])
    const oct = billedOf(d.l, cards.bca)[3]
    expect(draftIssues(d.l, oct.id).notOnStatementRows).toEqual([])
    const { user } = await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText("1 unbilled charge didn't show up on the Nov 2026 statement")).toBeTruthy()
    await user.click(within(panel).getByRole('link', { name: 'Resolve' }))
    expect(location()).toBe(`/transactions?statement=${unb}&row=ghost`)
    // Transactions opens Unbilled with that row's sheet.
    expect(await screen.findByRole('dialog', { name: /GRAB\* A-1PENDING/ })).toBeTruthy()
  })

  it('F-09 a totals difference does not block Final but stays visible on the Final panel and the hero', async () => {
    const { db, cards } = await household()
    await assignAll(db, cards.bca)
    await markReviewed(db, (await loadLedger(db, cards.bca)).transactions.map((t) => t.id))
    const nov = latestBilled(await loadLedger(db, cards.bca), cards.bca)!
    await db.statements.put({ ...nov, printed: { ...nov.printed, purchases: nov.printed.purchases + 1, newBalance: nov.printed.newBalance + 1 } })
    expect(draftIssues(await loadLedger(db, cards.bca), nov.id).final).toBe(true)
    await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText('Final, but totals differ from the bank by Rp 1')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Open in Transactions' }).getAttribute('href')).toBe(`/transactions?statement=${nov.id}`)
    expect(screen.getByLabelText('Totals warning').textContent).toBe('Totals differ from the bank by Rp 1.')
  })

  it('F-09 with every row checked and every payment assigned the bill is Final; totals match the bank', async () => {
    const { db, cards } = await household()
    await assignAll(db, cards.bca)
    await markReviewed(db, (await loadLedger(db, cards.bca)).transactions.map((t) => t.id))
    const d = await domain(db, cards, 'bca')
    expect(draftIssues(d.l, d.s).final).toBe(true)
    await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText('Final ✓')).toBeTruthy()
    expect(within(panel).getByText('Every row checked and every payment assigned. Totals match the bank.')).toBeTruthy()
    expect(screen.queryByLabelText('Totals warning')).toBeNull()
  })

  it('F-10 a negative fee (a rebate) is accepted from Bill: stored on the row; the statement turns Final', async () => {
    const { db, cards } = await household()
    await assignAll(db, cards.bca)
    await markReviewed(db, (await loadLedger(db, cards.bca)).transactions.map((t) => t.id))
    const nov = latestBilled(await loadLedger(db, cards.bca), cards.bca)!
    await db.transactions.put(tx(cards.bca, nov.id, 'rebate', '2026-11-12', 'BIAYA ADM KARTU REBATE', -15_000, cards.owners.bca.Keluarga, { kind: 'fee' }))
    // The bank printed the rebate too, so the totals still match.
    await db.statements.put({ ...nov, printed: { ...nov.printed, feesInterest: nov.printed.feesInterest - 15_000, newBalance: nov.printed.newBalance - 15_000 } })
    const { user } = await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText('Negative fee: BIAYA ADM KARTU REBATE −15.000')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Fix' }).getAttribute('href')).toBe(`/transactions?statement=${nov.id}&row=rebate`)
    await user.click(within(panel).getByRole('button', { name: 'Accept as rebate' }))
    await waitFor(() => expect(within(screen.getByLabelText('Draft or Final')).getByText('Final ✓')).toBeTruthy())
    expect(await screen.findByText('Accepted as a rebate')).toBeTruthy()
    expect((await db.transactions.get('rebate'))!.signAccepted).toBe(true)
    expect(draftIssues(await loadLedger(db, cards.bca), nov.id).wrongSignRows).toEqual([])
    // The rebate shows as "Rebate", not "Refund", in the person's fees.
    await user.click(ownerRow('Keluarga'))
    const fees = await screen.findByLabelText('Fees and interest')
    const row = within(fees).getByLabelText('BIAYA ADM KARTU REBATE −15.000')
    expect(within(row).getByText('Rebate')).toBeTruthy()
    expect(within(row).queryByText('Refund')).toBeNull()
  })

  it('F-10 a wrong sign that is not a rebate only offers Fix', async () => {
    const { db, cards } = await household()
    const nov = latestBilled(await loadLedger(db, cards.bca), cards.bca)!
    await db.transactions.put(tx(cards.bca, nov.id, 'neg', '2026-11-11', 'CASHBACK', -9_000, cards.owners.bca.Andi, { kind: 'purchase' }))
    await openBill(db, cards.bca)
    const panel = screen.getByLabelText('Draft or Final')
    expect(within(panel).getByText('Sign looks wrong: CASHBACK −9.000')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Accept as rebate' })).toBeNull()
  })

  it('F-10 the Transactions row sheet accepts a rebate too (Fix the sign → Accept as rebate)', async () => {
    const { db, cards } = await household()
    const nov = latestBilled(await loadLedger(db, cards.bca), cards.bca)!
    await db.transactions.put(tx(cards.bca, nov.id, 'rebate', '2026-11-12', 'BUNGA KOREKSI', -2_500, cards.owners.bca.Keluarga, { kind: 'interest' }))
    prefSet(PREF_KEYS.selectedCard, cards.bca)
    const { user } = renderRoutes(ROUTES, `/transactions?statement=${nov.id}&row=rebate`, { db })
    const sheet = await screen.findByRole('dialog', { name: /BUNGA KOREKSI/ })
    await user.click(within(sheet).getByText('Fix amount, date or description'))
    await user.click(within(sheet).getByRole('button', { name: /^Fix the sign/ }))
    const fix = screen.getByRole('dialog', { name: 'Fix the sign' })
    await user.click(within(within(fix).getByLabelText('Accept as rebate')).getByRole('button', { name: 'Accept as rebate' }))
    await waitFor(async () => expect((await db.transactions.get('rebate'))!.signAccepted).toBe(true))
    expect(draftIssues(await loadLedger(db, cards.bca), nov.id).wrongSignRows).toEqual([])
  })
})

describe('empty states and look', () => {
  it('no cards: asks to add one', async () => {
    renderRoutes(ROUTES, '/bill')
    expect(await screen.findByText('No cards yet. Add your card, its owners and its palette first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add a card' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })

  it('a card without statements: asks to import; its tile shows no total', async () => {
    const db = freshNewDb()
    await saveCard(db, { name: 'Kartu Baru', bank: 'BNI', last4: '0001', statementDay: '', palette: 'green', owners: [{ name: 'Andi', color: '#000' }], defaultIndex: 0 })
    renderRoutes(ROUTES, '/bill', { db })
    expect(await screen.findByText('No statements on this card yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Import the first one' }).getAttribute('href')).toBe('/import')
    const tile = screen.getByRole('button', { name: 'Kartu Baru' })
    expect(within(tile).getByText('No statement yet')).toBeTruthy()
    expect(within(tile).getByText('—')).toBeTruthy()
    expect(screen.getByRole('link', { name: '+ Add card' }).getAttribute('href')).toBe('/settings')
  })

  it('M-11 all paid: the hero and each person say "Paid ✓", not 0', async () => {
    const db = freshNewDb()
    const cardId = await saveCard(db, { name: 'Kartu Lunas', bank: 'BNI', last4: '0002', statementDay: '12', palette: 'rose', owners: [{ name: 'Andi', color: '#000' }, { name: 'Sari', color: '#111' }], defaultIndex: 0 })
    const owners = await db.owners.where('cardId').equals(cardId).toArray()
    const andi = owners.find((o) => o.name === 'Andi')!.id
    await db.statements.put({ id: 'lunas-oct', cardId, kind: 'billed', statementDate: '2026-10-12', dueDate: '2026-10-28', printed: { prevBalance: 0, credits: 0, purchases: 90_000, feesInterest: 0, newBalance: 90_000 } })
    await db.transactions.put(tx(cardId, 'lunas-oct', 'k1', '2026-10-03', 'KOPI', 90_000, andi))
    await db.payments.put({ id: 'lunas-pay', cardId, source: 'manual', date: '2026-10-05', amount: 90_000, allocations: [{ txId: 'k1', amount: 90_000 }] })
    renderRoutes(ROUTES, '/bill', { db })
    await screen.findByLabelText('To pay')
    expect(big()).toBe('Paid ✓')
    expect(screen.getByText('Everything on this bill is paid.')).toBeTruthy()
    expect(within(ownerRow('Andi')).getByText('Paid ✓')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Sari: / })).toBeNull()
    expect(screen.getByRole('button', { name: `Kartu Lunas ${rp(0)}` })).toBeTruthy()
  })

  it('U-08 the To-pay box never repeats the selected card tile, in Clean, Soft and Bold', async () => {
    const { db, cards } = await household()
    for (const look of ['clean', 'soft', 'bold']) {
      prefSet(PREF_KEYS.look, look)
      await openBill(db, cards.bca)
      const tile = screen.getByRole('button', { name: /^BCA Keluarga / })
      expect(tile.style.getPropertyValue('--fill')).toBe('var(--tile)')
      await waitFor(() => expect(token('--tile')).not.toBe(''))
      expect(token('--hero')).not.toBe(token('--tile'))
      cleanup()
    }
  })
})

// Keeps the helpers honest: the fixture tagging really sets owners (otherwise every row would be Keluarga's).
it('the household helper tags rows with their expected owners', async () => {
  const { db, cards } = await household()
  const l: Ledger = await loadLedger(db, cards.bca)
  const owners = new Set(l.transactions.map((t) => t.ownerId))
  expect(owners).toEqual(new Set(['Andi', 'Sari', 'Bima', 'Keluarga', 'Medis'].map((n) => cards.owners.bca[n])))
  const bills: OwnerBill[] = cardBill(l, ownerIds(cards, 'bca'), latestBilled(l, cards.bca)!.id, todayIso()).owners
  expect(bills.map((b) => b.ownerId)).toEqual(ownerIds(cards, 'bca'))
})
