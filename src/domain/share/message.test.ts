// Share messages (docs/test-plan.md S-01..S-04, S-06 text side). Synthetic household from test/fixtures (fictional).
import { describe, expect, it } from 'vitest'
import household from '../../../test/fixtures/household.json'
import { billed, ledger, months, pay, tx, unbilled } from '../../../test/domain/builders'
import { BCA_OWNERS, householdLedger, TODAY } from '../../../test/payments/household'
import { cardBill, ownerBill } from '../bill'
import { MoneyError } from '../money'
import { rupiah } from './format'
import { shareCard, shareMessage, shareText, type ShareContext } from './message'

const HH = householdLedger()
const OWNERS = BCA_OWNERS.map((name) => ({ id: name, name }))
const ctx = (statementId: string, extra: Partial<ShareContext> = {}): ShareContext => ({
  ledger: HH,
  card: { name: household.cards.bca.name },
  owners: OWNERS,
  statementId,
  today: TODAY,
  ...extra,
})

describe('one person', () => {
  it('S-01 Bahasa: title, due, "Per <date>", total equals the Bill screen', () => {
    const m = shareMessage(ctx('bca-2026-11'), { ownerId: 'Sari' })
    expect(m.text).toBe(
      [
        '*Tagihan BCA Keluarga · Nov 2026* (jatuh tempo 28 Nov)',
        'Per 1 Nov 2026',
        '⚠️ *SEMENTARA* — angka bisa berubah',
        '',
        '*Sari: Rp 928.734*',
        'Tagihan Nov 2026: Rp 1.049.367',
        'Sudah dibayar: Rp 120.633',
        '- 15 Okt BLIBLI (cicilan 2/6): 729.367',
        '- 16 Okt TOKOPEDIA: 320.000',
      ].join('\n'),
    )
    const b = ownerBill(HH, 'Sari', 'bca-2026-11', TODAY)
    expect(m.total).toBe(b.mustPay)
    expect(m.text).toContain(`*Sari: ${rupiah(b.mustPay)}*`)
    expect(m.text).toContain(`Tagihan Nov 2026: ${rupiah(b.charges)}`)
    expect(m.text).toContain(`Sudah dibayar: ${rupiah(b.alreadyPaid)}`)
    expect(m.final).toBe(false)
  })

  it('S-01 English, with older unpaid per month and a credit carried from an older bill', () => {
    const m = shareMessage(ctx('bca-2026-11', { lang: 'en' }), { ownerId: 'Andi' })
    expect(m.text).toBe(
      [
        '*Bill BCA Keluarga · Nov 2026* (due 28 Nov)',
        'As of 1 Nov 2026',
        '⚠️ *PROVISIONAL* — numbers may change',
        '',
        '*Andi: Rp 1.458.243*',
        '- 14 Oct GRAB: 9.000',
        '- 25 Oct GARMIN INDONESIA (installment 5/12): 499.917',
        '- Unpaid Oct 2026: 649.917',
        '- Unpaid Sep 2026: 508.917',
        '- Credit Aug 2026: −209.508',
      ].join('\n'),
    )
    const b = ownerBill(HH, 'Andi', 'bca-2026-11', TODAY)
    expect(m.total).toBe(b.mustPay)
    expect(b.olderRemaining + b.thisRemaining).toBe(1458243)
  })

  it('a Final bill has no Draft marker; paid rows are marked and the owner reads "✓ lunas"', () => {
    const m = shareMessage(ctx('bca-2026-07'), { ownerId: 'Medis' })
    expect(m.final).toBe(true)
    expect(m.total).toBe(0)
    expect(m.text).toBe(
      [
        '*Tagihan BCA Keluarga · Jul 2026* (jatuh tempo 28 Jul)',
        'Per 1 Nov 2026',
        '',
        '*Medis: Rp 0* ✓ lunas',
        'Tagihan Jul 2026: Rp 650.000',
        'Sudah dibayar: Rp 650.000',
        '- 5 Jul RS PONDOK: 650.000 (lunas)',
      ].join('\n'),
    )
  })

  it('without the list of charges: totals and older unpaid stay, rows go', () => {
    const m = shareMessage(ctx('bca-2026-09', { list: false }), { ownerId: 'Keluarga' })
    expect(m.text).toBe(
      ['*Tagihan BCA Keluarga · Sep 2026* (jatuh tempo 28 Sep)', 'Per 1 Nov 2026', '', '*Keluarga: Rp 410.508*', '- Sisa Agu 2026: 209.508'].join('\n'),
    )
    expect(m.total).toBe(ownerBill(HH, 'Keluarga', 'bca-2026-09', TODAY).mustPay)
  })

  it('empty charges: an owner with nothing on the bill', () => {
    const m = shareMessage(ctx('bca-2026-07'), { ownerId: 'Sari' })
    expect(m.text).toBe(
      ['*Tagihan BCA Keluarga · Jul 2026* (jatuh tempo 28 Jul)', 'Per 1 Nov 2026', '', '*Sari: Rp 0* ✓ lunas', 'Tidak ada transaksi di tagihan ini.'].join('\n'),
    )
    expect(shareMessage(ctx('bca-2026-07', { lang: 'en' }), { ownerId: 'Sari' }).text.split('\n').slice(-2)).toEqual(['*Sari: Rp 0* ✓ paid', 'No transactions on this bill.'])
    expect(m.total).toBe(0)
  })

  it('Unbilled: no due date, "Belum ditagih" / "Unbilled", older bills listed', () => {
    const m = shareMessage(ctx('bca-unb'), { ownerId: 'Medis' })
    expect(m.text).toBe(
      ['*Tagihan BCA Keluarga · Belum ditagih*', 'Per 1 Nov 2026', '', '*Medis: Rp 1.235.000*', '- Sisa Nov 2026: 85.000', '- Sisa Okt 2026: 1.150.000'].join('\n'),
    )
    expect(shareMessage(ctx('bca-unb', { lang: 'en' }), { ownerId: 'Medis' }).text.split('\n')[0]).toBe('*Bill BCA Keluarga · Unbilled*')
  })
})

describe('credit, refunds, reversals and deposits', () => {
  it('S-04 refunds are labelled and the unused refund shows as credit (Rp 0, ✓ paid)', () => {
    const m = shareMessage(ctx('bca-2026-08', { lang: 'en' }), { ownerId: 'Andi' })
    expect(m.text).toBe(
      [
        '*Bill BCA Keluarga · Aug 2026* (due 28 Aug)',
        'As of 1 Nov 2026',
        '⚠️ *PROVISIONAL* — numbers may change',
        '',
        '*Andi: Rp 0* ✓ paid',
        'Charges Aug 2026: Rp 508.917',
        'Already paid: Rp 718.425',
        '- 14 Jul GRAB: 9.000 (paid)',
        '- 21 Jul SHOPEE: 381.327 (paid)',
        '- 25 Jul GARMIN INDONESIA (installment 2/12): 499.917',
        '- 2 Aug SHOPEE: −381.327 (refund)',
        'Refund credit (lowers the next bill): Rp 209.508',
      ].join('\n'),
    )
    const b = ownerBill(HH, 'Andi', 'bca-2026-08', TODAY)
    expect(b.credit).toBe(209508)
    expect(m.text).toContain(rupiah(b.credit))
    expect(shareMessage(ctx('bca-2026-08'), { ownerId: 'Andi' }).text).toContain('- 2 Agu SHOPEE: −381.327 (refund)\nKredit refund (mengurangi tagihan berikutnya): Rp 209.508')
  })

  it('S-04 a purchase moved to installment and its reversal are never listed', () => {
    const sep = shareMessage(ctx('bca-2026-09'), { ownerId: 'Sari' })
    expect(sep.text).toBe(['*Tagihan BCA Keluarga · Sep 2026* (jatuh tempo 28 Sep)', 'Per 1 Nov 2026', '', '*Sari: Rp 0* ✓ lunas'].join('\n'))
    expect(ownerBill(HH, 'Sari', 'bca-2026-09', TODAY).lines.map((l) => l.status)).toEqual(['notCounted'])
    const all = [...['bca-2026-09', 'bca-2026-10', 'bca-2026-11'].map((s) => shareMessage(ctx(s), 'all').text)].join('\n')
    expect(all).not.toMatch(/REVERSAL|4\.376\.200/)
  })

  it('deposit waiting is shown; a partly paid row has no mark', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('a', 'oct', '2026-10-01', 300000, 'sari'), tx('b', 'oct', '2026-10-02', 200000, 'sari', { description: 'TOKO BUKU' })],
      payments: [pay('p', '2026-09-30', 450000, { allocations: [{ txId: 'b', amount: 50000 }], depositOwnerId: 'sari' })],
    })
    const c: ShareContext = { ledger: l, card: { name: 'Kartu' }, owners: [{ id: 'sari', name: 'Sari' }], statementId: 'oct', today: '2026-10-20' }
    expect(ownerBill(l, 'sari', 'oct', '2026-10-20').mustPay).toBe(50000)
    const l2 = { ...l, payments: [{ ...l.payments[0], amount: 900000 }] }
    const c2 = { ...c, ledger: l2 }
    expect(shareMessage(c2, { ownerId: 'sari' }).text.split('\n').slice(2)).toEqual([
      '⚠️ *SEMENTARA* — angka bisa berubah',
      '',
      '*Sari: Rp 0* ✓ lunas',
      'Tagihan Okt 2026: Rp 500.000',
      'Sudah dibayar: Rp 500.000',
      '- 1 Okt A: 300.000 (lunas)',
      '- 2 Okt TOKO BUKU: 200.000 (lunas)',
      'Deposit tersisa: Rp 400.000',
    ])
    expect(ownerBill(l2, 'sari', 'oct', '2026-10-20').depositWaiting).toBe(400000)
    const partial = { ...c, ledger: { ...l, payments: [pay('q', '2026-10-05', 120000, { source: 'statement', statementId: 'oct', allocations: [{ txId: 'a', amount: 120000 }] })] } }
    expect(shareMessage({ ...partial, lang: 'en' }, { ownerId: 'sari' }).text.split('\n').slice(2)).toEqual([
      '',
      '*Sari: Rp 380.000*',
      'Charges Oct 2026: Rp 500.000',
      'Already paid: Rp 120.000',
      '- 1 Oct A: 300.000',
      '- 2 Oct TOKO BUKU: 200.000',
    ])
  })
})

describe('everyone (card-level summary)', () => {
  it('S-02 one block per owner with charges or older unpaid, and the card total', () => {
    const m = shareMessage(ctx('bca-2026-08'), 'all')
    expect(m.text).toBe(
      [
        '*Tagihan BCA Keluarga · Agu 2026* (jatuh tempo 28 Agu)',
        'Per 1 Nov 2026',
        '⚠️ *SEMENTARA* — angka bisa berubah',
        '',
        '*Andi: Rp 0* ✓ lunas',
        'Tagihan Agu 2026: Rp 508.917',
        'Sudah dibayar: Rp 718.425',
        '- 14 Jul GRAB: 9.000 (lunas)',
        '- 21 Jul SHOPEE: 381.327 (lunas)',
        '- 25 Jul GARMIN INDONESIA (cicilan 2/12): 499.917',
        '- 2 Agu SHOPEE: −381.327 (refund)',
        'Kredit refund (mengurangi tagihan berikutnya): Rp 209.508',
        '',
        '*Sari: Rp 0* ✓ lunas',
        'Tagihan Agu 2026: Rp 1.607.840',
        'Sudah dibayar: Rp 1.607.840',
        '- 21 Jul SHOPEE: 355.840 (lunas)',
        '- 21 Jul SHOPEE: 1.252.000 (lunas)',
        '',
        '*Keluarga: Rp 209.508*',
        '- 28 Jul NETFLIX: 186.000',
        '- 12 Agu BUNGA: 23.508',
        '',
        '*Total semua: Rp 209.508*',
      ].join('\n'),
    )
    // Bima and Medis have nothing on Aug and nothing older: no block.
    expect(m.text).not.toMatch(/Bima|Medis/)
    expect(m.total).toBe(cardBill(HH, BCA_OWNERS, 'bca-2026-08', TODAY).total)
  })

  it('S-02 every owner with older unpaid gets a block; totals match cardBill', () => {
    for (const s of ['bca-2026-09', 'bca-2026-10', 'bca-2026-11', 'bca-unb']) {
      const m = shareMessage(ctx(s), 'all')
      const cb = cardBill(HH, BCA_OWNERS, s, TODAY)
      expect(m.total).toBe(cb.total)
      expect(m.text).toContain(`*Total semua: ${rupiah(cb.total)}*`)
      for (const b of cb.owners) if (b.lines.length || b.older.length) expect(m.text).toContain(`*${b.ownerId}: ${rupiah(b.mustPay)}*`)
    }
    expect(shareMessage(ctx('bca-2026-10', { lang: 'en' }), 'all').text.split('\n').slice(-2)).toEqual(['', '*Total, everyone: Rp 3.401.729*'])
  })

  it('rows without an owner get their own block; an owner with nothing gets none; empty card says so', () => {
    const l = ledger({ statements: [billed('oct', '2026-10-12', '2026-10-28'), unbilled()], transactions: [tx('n', 'oct', '2026-10-03', 75000, null)] })
    const c: ShareContext = { ledger: l, card: { name: 'Kartu' }, owners: [{ id: 'sari', name: 'Sari' }], statementId: 'oct', today: '2026-10-20' }
    expect(shareMessage(c, 'all').text.split('\n').slice(2)).toEqual(['', '*Tanpa pemilik: Rp 75.000*', '- 3 Okt N: 75.000', '', '*Total semua: Rp 75.000*'])
    expect(shareMessage({ ...c, lang: 'en' }, { ownerId: null }).text.split('\n')[3]).toBe('*No owner: Rp 75.000*')
    const empty = { ...c, ledger: { ...l, transactions: [] } }
    expect(shareMessage(empty, 'all')).toEqual({
      text: ['*Tagihan Kartu · Okt 2026* (jatuh tempo 28 Okt)', 'Per 20 Okt 2026', '', 'Tidak ada transaksi di tagihan ini.', '', '*Total semua: Rp 0*'].join('\n'),
      total: 0,
      final: true,
    })
  })
})

describe('labels and privacy', () => {
  it("uses the row's own label, else the merchant", () => {
    const l = ledger({
      statements: months(),
      transactions: [
        tx('a', 'oct', '2026-10-01', 54000, 'sari', { description: 'GRAB* A-8QW1ZXR JAKARTA PUSATID', label: 'Ojek ke kantor' }),
        tx('b', 'oct', '2026-10-02', 21000, 'sari', { description: 'GRAB* A-1ZZ JAKARTA', label: '' }),
      ],
    })
    const text = shareMessage({ ledger: l, card: { name: 'K' }, owners: [{ id: 'sari', name: 'Sari' }], statementId: 'oct', today: '2026-10-20' }, { ownerId: 'sari' }).text
    expect(text.split('\n').slice(-2)).toEqual(['- 1 Okt Ojek ke kantor: 54.000', '- 2 Okt GRAB: 21.000'])
  })

  it('never carries a card number beyond the last 4, the holder, the PDF password or an API key', () => {
    const texts = ['bca-2026-07', 'bca-2026-08', 'bca-2026-09', 'bca-2026-10', 'bca-2026-11', 'bca-unb'].flatMap((s) =>
      (['id', 'en'] as const).flatMap((lang) => [shareMessage(ctx(s, { lang }), 'all').text, ...OWNERS.map((o) => shareMessage(ctx(s, { lang }), { ownerId: o.id }).text)]),
    )
    for (const t of texts) {
      expect(t).not.toContain(household.password)
      expect(t).not.toContain(household.holder)
      expect(t).not.toContain(household.cards.bca.customerNo)
      expect(t).not.toMatch(/sk-ant|4556|\d{13}/)
    }
    const leaky = shareMessage(ctx('bca-2026-11', { card: { name: 'BCA 4556 7712 3456 1234' } }), { ownerId: 'Bima' }).text
    expect(leaky.split('\n')[0]).toBe('*Tagihan BCA ••••1234 · Nov 2026* (jatuh tempo 28 Nov)')
  })

  it('refuses an unknown statement or owner', () => {
    expect(() => shareMessage(ctx('nope'), 'all')).toThrow(new MoneyError('unknown statement nope'))
    expect(() => shareMessage(ctx('bca-2026-11'), { ownerId: 'Zed' })).toThrow(new MoneyError('unknown owner Zed'))
  })
})

describe('share card (the model the text and the image are drawn from)', () => {
  it('S-06 one model: the text is rendered from the same card the image draws', () => {
    for (const s of ['bca-2026-08', 'bca-2026-11', 'bca-unb']) {
      for (const t of ['all', { ownerId: 'Andi' }] as const) expect(shareText(shareCard(ctx(s), t))).toBe(shareMessage(ctx(s), t).text)
    }
  })

  it('one person: header, "Per <date>", draft, rows with marks, older per month, extras', () => {
    expect(shareCard(ctx('bca-2026-08', { lang: 'en' }), { ownerId: 'Andi' })).toEqual({
      lang: 'en',
      title: 'Bill BCA Keluarga · Aug 2026',
      due: 'due 28 Aug',
      asOf: 'As of 1 Nov 2026',
      draft: { label: 'PROVISIONAL', note: 'numbers may change' },
      who: 'Andi',
      blocks: [
        {
          name: 'Andi',
          amount: 'Rp 0',
          settled: true,
          headline: 'Paid ✓',
          summary: ['Charges Aug 2026: Rp 508.917', 'Already paid: Rp 718.425'],
          rows: [
            { label: '14 Jul GRAB', amount: '9.000', mark: 'paid', paid: true },
            { label: '21 Jul SHOPEE', amount: '381.327', mark: 'paid', paid: true },
            { label: '25 Jul GARMIN INDONESIA (installment 2/12)', amount: '499.917', mark: null, paid: false },
            { label: '2 Aug SHOPEE', amount: '−381.327', mark: 'refund', paid: false },
          ],
          older: [],
          extras: ['Refund credit (lowers the next bill): Rp 209.508'],
          empty: null,
        },
      ],
      nothing: null,
      totalLine: null,
      total: 0,
      final: false,
    })
  })

  it('everyone: who is "Semua", headline is the amount when open, older per month', () => {
    const c = shareCard(ctx('bca-2026-11'), 'all')
    expect([c.who, c.due, c.asOf, c.draft, c.totalLine, c.nothing]).toEqual([
      'Semua',
      'jatuh tempo 28 Nov',
      'Per 1 Nov 2026',
      { label: 'SEMENTARA', note: 'angka bisa berubah' },
      `Total semua: ${rupiah(cardBill(HH, BCA_OWNERS, 'bca-2026-11', TODAY).total)}`,
      null,
    ])
    const bima = c.blocks.find((b) => b.name === 'Bima')!
    expect(bima).toMatchObject({ headline: 'Rp 535.000', settled: false, rows: [], older: [{ label: 'Sisa Okt 2026', amount: '245.000' }, { label: 'Sisa Sep 2026', amount: '290.000' }], empty: null })
    expect(shareCard(ctx('bca-2026-07'), { ownerId: 'Sari' }).blocks[0]).toMatchObject({ headline: 'Lunas ✓', empty: 'Tidak ada transaksi di tagihan ini.' })
    expect(shareCard(ctx('bca-unb', { lang: 'en' }), 'all')).toMatchObject({ who: 'Everyone', due: null, draft: null, final: true })
  })

  it('masks card numbers in owner names and row labels too', () => {
    const l = ledger({ statements: months(), transactions: [tx('a', 'oct', '2026-10-01', 1000, 'o', { label: 'Kartu 4556771234561234' })] })
    const c = shareCard({ ledger: l, card: { name: 'K' }, owners: [{ id: 'o', name: 'Sari 4556 7712 3456 9999' }], statementId: 'oct', today: '2026-10-20' }, { ownerId: 'o' })
    expect([c.who, c.blocks[0].name, c.blocks[0].rows[0].label]).toEqual(['Sari ••••9999', 'Sari ••••9999', '1 Okt Kartu ••••1234'])
  })
})

describe('hardening', () => {
  it('a label or name cannot add lines or markup (no fake total line)', () => {
    const l = ledger({ statements: months(), transactions: [tx('a', 'oct', '2026-10-01', 1000, 'o', { label: 'Kopi\n\n*Total semua: Rp 0*' })] })
    const text = shareMessage({ ledger: l, card: { name: 'K*_~' }, owners: [{ id: 'o', name: '*Sari*\nBos' }], statementId: 'oct', today: '2026-10-20' }, 'all').text
    expect(text).toBe(['*Tagihan K · Okt 2026* (jatuh tempo 28 Okt)', 'Per 20 Okt 2026', '', '*Sari Bos: Rp 1.000*', '- 1 Okt Kopi Total semua: Rp 0: 1.000', '', '*Total semua: Rp 1.000*'].join('\n'))
  })

  it('everyone includes an owner whose only balance is a deposit waiting', () => {
    const l = ledger({
      statements: months(),
      transactions: [tx('a', 'oct', '2026-10-01', 1000, 'sari')],
      payments: [pay('p', '2026-10-05', 50000, { source: 'statement', statementId: 'oct', allocations: [], depositOwnerId: 'bima' })],
    })
    const owners = [{ id: 'sari', name: 'Sari' }, { id: 'bima', name: 'Bima' }, { id: 'zed', name: 'Zed' }]
    const text = shareMessage({ ledger: l, card: { name: 'K' }, owners, statementId: 'oct', today: '2026-10-20' }, 'all').text
    expect(text.split('\n').slice(2)).toEqual(['', '*Sari: Rp 1.000*', '- 1 Okt A: 1.000', '', '*Bima: Rp 0* ✓ lunas', 'Deposit tersisa: Rp 50.000', 'Tidak ada transaksi di tagihan ini.', '', '*Total semua: Rp 1.000*'])
  })
})
