import { describe, expect, it } from 'vitest'
import { MoneyError } from '../money'
import { amount, dayMonth, fullDate, maskCardNumbers, monthYear, rupiah, WORDS } from './format'
import { whatsappAppUrl, whatsappWebUrl } from './links'

describe('share number and date formats', () => {
  it('groups integer rupiah the id-ID way, minus sign for credits', () => {
    expect([0, 7, 999, 1000, 9000, 100000, 1234567, 1000000000].map(amount)).toEqual(['0', '7', '999', '1.000', '9.000', '100.000', '1.234.567', '1.000.000.000'])
    expect(amount(-44631)).toBe('−44.631')
    expect(amount(-5)).toBe('−5')
    expect(rupiah(1234567)).toBe('Rp 1.234.567')
    expect(rupiah(0)).toBe('Rp 0')
  })

  it('agrees with toLocaleString("id-ID") on whole rupiah', () => {
    for (const n of [1, 12, 123, 1234, 12345, 123456, 1234567, 98765432]) expect(amount(n)).toBe(n.toLocaleString('id-ID'))
  })

  it('refuses fractions of a rupiah', () => {
    expect(() => amount(1.5)).toThrow(MoneyError)
  })

  it('writes dates in Bahasa and English', () => {
    const id = Array.from({ length: 12 }, (_, i) => dayMonth(`2026-${String(i + 1).padStart(2, '0')}-05`, 'id'))
    expect(id).toEqual(['5 Jan', '5 Feb', '5 Mar', '5 Apr', '5 Mei', '5 Jun', '5 Jul', '5 Agu', '5 Sep', '5 Okt', '5 Nov', '5 Des'])
    const en = Array.from({ length: 12 }, (_, i) => dayMonth(`2026-${String(i + 1).padStart(2, '0')}-28`, 'en'))
    expect(en).toEqual(['28 Jan', '28 Feb', '28 Mar', '28 Apr', '28 May', '28 Jun', '28 Jul', '28 Aug', '28 Sep', '28 Oct', '28 Nov', '28 Dec'])
    expect(fullDate('2026-11-01', 'id')).toBe('1 Nov 2026')
    expect(fullDate('2027-05-09', 'en')).toBe('9 May 2027')
    expect(monthYear('2026-10-12', 'id')).toBe('Okt 2026')
    expect(monthYear('2026-12-12', 'en')).toBe('Dec 2026')
  })

  it('has the same wording keys in both languages', () => {
    expect(Object.keys(WORDS.en)).toEqual(Object.keys(WORDS.id))
  })
})

describe('card numbers are masked to the last 4', () => {
  it('masks 13 to 19 digits, with or without spaces and dashes', () => {
    expect(maskCardNumbers('4556 7712 3456 1234')).toBe('••••1234')
    expect(maskCardNumbers('card 4556-7712-3456-9876 ok')).toBe('card ••••9876 ok')
    expect(maskCardNumbers('x4556771234561234y')).toBe('x••••1234y')
    expect(maskCardNumbers('1234567890123')).toBe('••••0123')
    expect(maskCardNumbers('1234567890123456789')).toBe('••••6789')
  })

  it('leaves amounts, dates and short numbers alone', () => {
    const text = 'Rp 1.234.567.890.123 · 28 Okt 2026 · 081234567890 · 1234'
    expect(maskCardNumbers(text)).toBe(text)
  })
})

describe('WhatsApp links', () => {
  const text = '*Tagihan BCA · Okt 2026*\nPer 1 Nov 2026\n⚠️ *SEMENTARA* — angka bisa berubah\n- 5 Okt A&B #1 +50%: 1.000 ✓'

  it('encode the text so it round-trips, emoji and newlines included', () => {
    const web = whatsappWebUrl(text)
    expect(web.startsWith('https://wa.me/?text=')).toBe(true)
    expect(web).not.toMatch(/[\n &#+]/)
    expect(new URL(web).searchParams.get('text')).toBe(text)
    expect(decodeURIComponent(web.slice('https://wa.me/?text='.length))).toBe(text)
    expect(web).toContain('%0A')
    expect(web).toContain(encodeURIComponent('⚠️'))
  })

  it('app scheme carries the same text', () => {
    const app = whatsappAppUrl(text)
    expect(app.startsWith('whatsapp://send?text=')).toBe(true)
    expect(decodeURIComponent(app.slice('whatsapp://send?text='.length))).toBe(text)
  })
})
