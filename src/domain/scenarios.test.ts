// End-to-end money scenarios on the synthetic household (test/fixtures). Owner ids are the fixture owner names.
import { describe, expect, it } from 'vitest'
import household from '../../test/fixtures/household.json'
import bca07 from '../../test/fixtures/statements/bca-2026-07.expected.json'
import { BCA_FILES, fixtureLedger, MANDIRI_FILES, rowId } from '../../test/domain/builders'
import { checkDraft, fillOldestFirst, savePayment, tapCharge, type AssignDraft } from './allocate'
import { computeMoney, countedPayments, depositLeftOf, depositPaidOf, paidOf, txStatus } from './amounts'
import { cardBill, feeOwner, ownerBill } from './bill'
import { draftIssues } from './draft'
import { convertToInstallment, type ConversionResult } from './installments'
import { applyLinks, classifyCredit, matchManualPayments } from './matching'
import { bankStatus, deletePayment, keepWaiting, keepWaitingRow } from './payments'
import { reconcileStatement } from './reconcile'
import type { Ledger, Payment, Transaction } from './types'

const TODAY = '2026-11-01'
const BCA_OWNERS = household.cards.bca.owners
const all = (l: Ledger, paymentId: string, date: string, amount: number): AssignDraft => ({
  paymentId, cardId: 'bca', date, amount, ownerIds: BCA_OWNERS, multi: true, allocations: {},
})
const replacePayment = (l: Ledger, p: Payment): Ledger => ({ ...l, payments: l.payments.map((x) => (x.id === p.id ? p : x)) })
const assignAll = (l: Ledger, id: string): Ledger => {
  const p = l.payments.find((x) => x.id === id)!
  const { draft } = fillOldestFirst(l, all(l, p.id, p.date, p.amount))
  return replacePayment(l, savePayment(l, p, draft, null))
}
const mustPay = (l: Ledger, statementId: string) => Object.fromEntries(cardBill(l, BCA_OWNERS, statementId, TODAY).owners.map((o) => [o.ownerId, o.mustPay]))

const bca = fixtureLedger(BCA_FILES, 'bca')
const id = (file: string, description: string, amount?: number) => rowId(bca, file, description, amount)
const JUL_PAY = id('bca-2026-08', 'PEMBAYARAN', 1000000)
const AUG_PAY = id('bca-2026-09', 'PEMBAYARAN', 3122682)
const WATSONS_PAY = id('bca-2026-10', 'PEMBAYARAN', 200000)
const SEP_PAY = id('bca-2026-10', 'PEMBAYARAN', 1470000)
const OCT20_LINE = id('bca-2026-11', 'PEMBAYARAN', 2000000)
const OCT30_LINE = id('bca-2026-11', 'PEMBAYARAN', 1500000)
const BLIBLI = id('bca-2026-09', 'BLIBLI')
const KIDZANIA = id('bca-2026-09', 'KIDZANIA')
const REVERSAL = id('bca-2026-10', 'REVERSAL CICILAN')
const INST1 = id('bca-2026-10', 'CICILAN BCA KE 01 DARI 06')
const INST2 = id('bca-2026-11', 'CICILAN BCA KE 02 DARI 06')
const WATSONS = id('bca-2026-10', 'WATSONS')
const SARI_SHOPEE_OCT = bca.transactions.find((t) => t.statementId === 'bca-2026-10' && t.description.startsWith('SHOPEE') && t.ownerId === 'Sari')!.id
const TOKOPEDIA = id('bca-2026-11', 'TOKOPEDIA')

const [bimaHand, andiHand] = household.handRecorded.payments.map(
  (h, i): Payment => ({ id: ['hand-0905', 'hand-1018'][i], cardId: h.card, source: 'manual', date: h.date, amount: h.amount, allocations: [], forOwnerIds: [h.owner] }),
)

describe('fixtures: totals and classification', () => {
  it('I-01 every BCA statement in the ledger reconciles to its printed new balance', () => {
    for (const e of BCA_FILES) expect(reconcileStatement(bca, e.file), e.file).toMatchObject({ ok: true, difference: 0 })
  })

  it('I-02 corrupting one amount by 1 rupiah reports exactly 1', () => {
    const gramedia = id('bca-2026-10', 'GRAMEDIA')
    const corrupt = { ...bca, transactions: bca.transactions.map((t) => (t.id === gramedia ? { ...t, amount: t.amount + 1 } : t)) }
    expect(reconcileStatement(corrupt, 'bca-2026-10')).toMatchObject({ ok: false, difference: 1 })
    expect(reconcileStatement(corrupt, 'bca-2026-09').ok).toBe(true)
  })

  it('I-06 every credit line in the fixtures is classified as its expected kind', () => {
    for (const e of [...BCA_FILES, ...MANDIRI_FILES]) for (const r of e.rows.filter((x) => x.amount < 0)) expect(classifyCredit(r.description), r.description).toBe(r.kind)
  })

  it('M-07 every fee and interest row belongs to the card default owner', () => {
    const owner = feeOwner({ id: 'bca', name: household.cards.bca.name, bank: 'BCA', defaultOwnerId: household.cards.bca.defaultOwner })
    const fees = BCA_FILES.flatMap((e) => e.rows).filter((r) => r.kind === 'fee' || r.kind === 'interest')
    expect(fees).toHaveLength(6)
    for (const r of fees) expect(r.expectedOwner).toBe(owner.ownerId)
    expect(owner.check).toBe(false)
  })

  it('M-09 with nothing paid, the Jul card total equals the printed new balance', () => {
    expect(cardBill(bca, BCA_OWNERS, 'bca-2026-07', TODAY).total).toBe(bca07.printed.newBalance)
  })

  it('M-05 Mandiri Oct: the Shopee refund cancels Rumah\'s Shopee charge; card total = printed new balance', () => {
    const m = fixtureLedger(MANDIRI_FILES, 'mandiri')
    const c = cardBill(m, household.cards.mandiri.owners, 'mandiri-2026-10', TODAY)
    expect(c.owners.map((o) => [o.ownerId, o.charges, o.mustPay])).toEqual([['Andi', 289034, 289034], ['Rumah', 283000, 283000], ['Kantor', 75000, 75000]])
    expect(c.total).toBe(647034)
    const refund = c.owners[1].lines.find((x) => x.tx.kind === 'refund')!
    expect([refund.effective, refund.status]).toEqual([-44631, 'refund'])
  })
})

describe('fixtures: the household story Jul → Nov', () => {
  // Jul 26 1.000.000 and Aug 27 3.122.682: "Fill oldest first" across everyone.
  const afterJul = assignAll(bca, JUL_PAY)
  const afterAug = assignAll(afterJul, AUG_PAY)

  it('M-01 Aug: the 1.000.000 payment leaves 796.417 of Jul unpaid, carried into the Aug bill', () => {
    const p = afterJul.payments.find((x) => x.id === JUL_PAY)!
    expect(p.allocations.map((a) => a.amount)).toEqual([9000, 13000, 186000, 245500, 499917, 46583])
    const bima = ownerBill(afterJul, 'Bima', 'bca-2026-08', TODAY)
    expect(bima.older.map((g) => [g.statement.id, g.remaining])).toEqual([['bca-2026-07', 131417]])
    expect(mustPay(afterJul, 'bca-2026-08')).toEqual({ Andi: 508917, Sari: 1607840, Bima: 131417, Keluarga: 224508, Medis: 650000 })
    // Every bank payment fully assigned → the card total is the bank's new balance.
    expect(cardBill(afterJul, BCA_OWNERS, 'bca-2026-08', TODAY).total).toBe(3122682)
  })

  it('M-D-90 Sep: Andi\'s Aug refund credit carries into his Sep bill; card total = Sep new balance', () => {
    expect(afterAug.payments.find((x) => x.id === AUG_PAY)!.allocations.map((a) => a.amount)).toEqual([131417, 650000, 15000, 9000, 355840, 381327, 1252000, 328098])
    expect(mustPay(afterAug, 'bca-2026-09')).toEqual({ Andi: 299409, Sari: 4376200, Bima: 760000, Keluarga: 410508, Medis: 0 })
    expect(cardBill(afterAug, BCA_OWNERS, 'bca-2026-09', TODAY).total).toBe(5846117)
    expect(draftIssues(afterAug, 'bca-2026-09')).toMatchObject({ blockingPayments: [], missingPayments: [] })
  })

  // Oct: Watsons paid the day after; Sep 27 1.470.000 paid 1.000.000 of the Blibli purchase and 470.000 of KidZania.
  const beforeConversion: Ledger = {
    ...afterAug,
    payments: afterAug.payments.map((p) =>
      p.id === WATSONS_PAY ? { ...p, allocations: [{ txId: WATSONS, amount: 200000 }] }
        : p.id === SEP_PAY ? { ...p, allocations: [{ txId: BLIBLI, amount: 1000000 }, { txId: KIDZANIA, amount: 470000 }] }
          : p,
    ),
  }
  const conversion = convertToInstallment(beforeConversion, REVERSAL, 'plan-blibli') as ConversionResult
  const merge = (l: Ledger, r: ConversionResult): Ledger => ({
    ...l,
    transactions: l.transactions.map((t) => r.transactions.find((x) => x.id === t.id) ?? t),
    payments: l.payments.map((p) => r.payments.find((x) => x.id === p.id) ?? p),
    plans: [...l.plans, r.plan],
  })
  const afterConversion = merge(beforeConversion, conversion)

  it('I-07 Oct: REVERSAL CICILAN cancels the Sep Blibli purchase; its 1.000.000 moves to 1/6 (729.367); 270.633 becomes Sari\'s deposit', () => {
    expect([conversion.originalId, conversion.installmentId, conversion.conflicts]).toEqual([BLIBLI, INST1, []])
    const sep = afterConversion.payments.find((p) => p.id === SEP_PAY)!
    expect(sep.allocations).toEqual([{ txId: KIDZANIA, amount: 470000 }, { txId: INST1, amount: 729367 }])
    expect(sep.depositOwnerId).toBe('Sari')
    const s = computeMoney(afterConversion)
    expect(paidOf(s, INST1)).toBe(729367)
    // The deposit (dated 27 Sep) pays Sari's later charges oldest first: Shopee 28 Sep, then installment 2/6 (15 Oct).
    expect(depositPaidOf(s, SARI_SHOPEE_OCT)).toBe(150000)
    expect(depositPaidOf(s, INST2)).toBe(120633)
    expect(depositLeftOf(s, sep)).toBe(0)
    expect(txStatus(s, afterConversion.transactions.find((t) => t.id === BLIBLI)!)).toBe('notCounted')
    expect(txStatus(s, afterConversion.transactions.find((t) => t.id === REVERSAL)!)).toBe('notCounted')
    expect(conversion.plan).toEqual({ id: 'plan-blibli', cardId: 'bca', ownerId: 'Sari', name: 'BLIBLI.COM *121 SEPEDA STATIS', monthly: 729367, total: 6, start: '2026-10' })
    // The bank still printed what it printed.
    for (const e of BCA_FILES) expect(reconcileStatement(afterConversion, e.file).ok).toBe(true)
  })

  it('D-05 Oct bill: Sari is settled, her deposit is used up, 5 installments to come', () => {
    const sari = ownerBill(afterConversion, 'Sari', 'bca-2026-10', TODAY)
    expect(sari).toMatchObject({ thisRemaining: 0, olderRemaining: 0, mustPay: 0, settled: true, depositWaiting: 0, installmentsToComeTotal: 5 * 729367 })
    expect(ownerBill(afterConversion, 'Sari', 'bca-2026-09', TODAY).mustPay).toBe(0)
    expect(ownerBill(afterConversion, 'Bima', 'bca-2026-09', TODAY).mustPay).toBe(290000)
    // 120.633 of the payments went to a Nov charge, so the Oct card total is the bank balance plus that.
    expect(cardBill(afterConversion, BCA_OWNERS, 'bca-2026-10', TODAY).total).toBe(3281096 + 120633)
  })

  // Nov: the 18 Oct hand payment matches the 20 Oct line; 30 Oct 1.500.000 is more than Sari owes.
  const links = matchManualPayments([...afterConversion.payments, bimaHand, andiHand])
  const withHand: Ledger = { ...afterConversion, payments: applyLinks([...afterConversion.payments, bimaHand, andiHand], links) }

  it('P-13 the 18 Oct hand payment links to the 20 Oct line (counted once); the 5 Sep one finds nothing', () => {
    expect(links).toEqual([{ paymentId: 'hand-1018', lineId: OCT20_LINE, days: 2 }])
    const hand = withHand.payments.find((p) => p.id === 'hand-1018')!
    expect(bankStatus(withHand, hand)).toEqual({ kind: 'linked', statementId: 'bca-2026-11' })
    expect(countedPayments(withHand.payments).map((p) => p.id)).not.toContain(OCT20_LINE)
  })

  it('F-07 the 5 Sep Bima payment is flagged missing ("Not on Sep statement")', () => {
    const bima = withHand.payments.find((p) => p.id === 'hand-0905')!
    expect(bankStatus(withHand, bima)).toEqual({ kind: 'missing', statementId: 'bca-2026-09' })
    expect(draftIssues(withHand, 'bca-2026-09')).toMatchObject({ missingPayments: ['hand-0905'], blockingPayments: [] })
    // P-15 Keep waiting: no longer missing, but still unassigned inside Sep's window, so it blocks Sep as a payment.
    const waiting = { ...withHand, payments: withHand.payments.map((p) => (p.id === 'hand-0905' ? keepWaiting(p) : p)) }
    expect(bankStatus(waiting, keepWaiting(bima)).kind).toBe('waiting')
    expect(draftIssues(waiting, 'bca-2026-09')).toMatchObject({ missingPayments: [], blockingPayments: ['hand-0905'] })
  })

  const oct30 = withHand.payments.find((p) => p.id === OCT30_LINE)!
  const sariDraft: AssignDraft = { paymentId: OCT30_LINE, cardId: 'bca', date: oct30.date, amount: oct30.amount, ownerIds: ['Sari'], multi: false, allocations: {} }
  const filled = fillOldestFirst(withHand, sariDraft)
  const withSari = replacePayment(withHand, savePayment(withHand, oct30, filled.draft, 'Sari'))

  it('D-01 the Nov 1.500.000 overpayment: 928.734 pays Sari\'s open charges, 571.266 becomes her deposit', () => {
    expect(filled.draft.allocations).toEqual({ [INST2]: 608734, [TOKOPEDIA]: 320000 })
    expect([filled.filled, filled.of]).toEqual([2, 2])
    expect(checkDraft(withHand, filled.draft).left).toBe(571266)
    expect(tapCharge(withHand, filled.draft, WATSONS).outcome).toBe('nothingOpen')
    const nov = ownerBill(withSari, 'Sari', 'bca-2026-11', TODAY)
    expect(nov).toMatchObject({ mustPay: 0, settled: true, depositWaiting: 571266, installmentsToComeTotal: 4 * 729367 })
    // A later Sari charge (15 Nov, Unbilled) is paid from the deposit.
    const later: Transaction = { id: 'unb-sari', cardId: 'bca', statementId: 'bca-unb', date: '2026-11-15', description: 'APOTEK', amount: 100000, kind: 'purchase', ownerId: 'Sari' }
    const withLater = { ...withSari, transactions: [...withSari.transactions, later] }
    const b = ownerBill(withLater, 'Sari', 'bca-2026-11', TODAY)
    expect(b.depositWaiting).toBe(471266)
    expect(b.notBilledYet.map((x) => [x.tx.id, x.fromDeposit, x.status])).toEqual([['unb-sari', 100000, 'paid']])
  })

  it('F-01..F-09 Nov is Draft until the Check row, the hand payment, the missing payment and the never-billed charge are resolved', () => {
    const pending: Transaction = { id: 'grab-pending', cardId: 'bca', statementId: 'bca-unb', date: '2026-10-09', description: 'GRAB* A-1PENDING JAKARTA PUSATID', amount: 27000, kind: 'purchase', ownerId: 'Andi' }
    const l = { ...withSari, transactions: [...withSari.transactions, pending] }
    expect(draftIssues(l, 'bca-2026-11')).toEqual({
      checkRows: [TOKOPEDIA],
      wrongSignRows: [],
      blockingPayments: ['hand-1018'],
      missingPayments: ['hand-0905'],
      possibleDuplicatePayments: [],
      notOnStatementRows: ['grab-pending'],
      notOnStatementPayments: [],
      count: 4,
      final: false,
    })
    // The 18 Oct payment also blocks Oct (dated between Sep 12 and Oct 28 due).
    expect(draftIssues(l, 'bca-2026-10').blockingPayments).toEqual(['hand-1018'])
    // The never-billed charge only blocks the latest statement.
    expect(draftIssues(l, 'bca-2026-10').notOnStatementRows).toEqual([])

    const hand = l.payments.find((p) => p.id === 'hand-1018')!
    const andi = fillOldestFirst(l, { paymentId: hand.id, cardId: 'bca', date: hand.date, amount: hand.amount, ownerIds: ['Andi'], multi: false, allocations: {} })
    // Andi's open charges up to 18 Oct (incl. the 27.000 pending Grab in Unbilled) are 1.366.653.
    expect(checkDraft(l, andi.draft).left).toBe(633347)
    const resolved: Ledger = {
      ...l,
      transactions: l.transactions.map((t) => (t.id === 'grab-pending' ? keepWaitingRow(t) : { ...t, check: false })),
      // The 5 Sep transfer never reached the bank: "Transfer failed, delete".
      payments: deletePayment(l.payments, 'hand-0905').map((p) => (p.id === 'hand-1018' ? savePayment(l, hand, andi.draft, 'Andi') : p)),
    }
    expect(draftIssues(resolved, 'bca-2026-11')).toMatchObject({ count: 0, final: true })
    for (const s of ['bca-2026-07', 'bca-2026-08', 'bca-2026-09', 'bca-2026-10']) expect(draftIssues(resolved, s).final, s).toBe(true)

    // Andi's deposit (18 Oct) pays his 25 Oct installment 5/12; 133.430 waits.
    const andiNov = ownerBill(resolved, 'Andi', 'bca-2026-11', TODAY)
    expect(andiNov).toMatchObject({ thisRemaining: 0, mustPay: 0, settled: true, depositWaiting: 133430 })
    expect(mustPay(resolved, 'bca-2026-11')).toEqual({ Andi: 0, Sari: 0, Bima: 535000, Keluarga: 968403, Medis: 1235000 })
    expect(cardBill(resolved, BCA_OWNERS, 'bca-2026-11', TODAY).total).toBe(2738403)
  })
})
