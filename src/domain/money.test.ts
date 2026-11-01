import { describe, expect, it } from 'vitest'
import { assertRupiah, daysBetween, MoneyError, monthIndex, sum } from './money'

describe('money helpers', () => {
  it('M-D-01 accepts integer rupiah and rejects floats, NaN and unsafe integers', () => {
    expect(assertRupiah(751248)).toBe(751248)
    expect(assertRupiah(-44631)).toBe(-44631)
    expect(assertRupiah(0)).toBe(0)
    expect(() => assertRupiah(0.5)).toThrow(MoneyError)
    expect(() => assertRupiah(Number.NaN, 'x')).toThrow('x must be an integer number of rupiah, got NaN')
    expect(() => assertRupiah(2 ** 53)).toThrow('amount must be an integer number of rupiah')
  })

  it('M-D-02 MoneyError carries its name', () => {
    expect(new MoneyError('boom').name).toBe('MoneyError')
    expect(new MoneyError('boom').message).toBe('boom')
  })

  it('M-D-03 sums exactly', () => {
    expect(sum([])).toBe(0)
    expect(sum([729367, 150000, -44631])).toBe(834736)
  })

  it('M-D-04 counts whole days in both directions, across months', () => {
    expect(daysBetween('2026-09-28', '2026-09-30')).toBe(2)
    expect(daysBetween('2026-09-30', '2026-09-28')).toBe(-2)
    expect(daysBetween('2026-10-30', '2026-11-12')).toBe(13)
    expect(daysBetween('2026-10-12', '2026-10-12')).toBe(0)
  })

  it('M-D-05 numbers months for dates and months', () => {
    expect(monthIndex('2026-10')).toBe(2026 * 12 + 10)
    expect(monthIndex('2026-11-12') - monthIndex('2026-10')).toBe(1)
    expect(monthIndex('2027-01-12') - monthIndex('2026-12-12')).toBe(1)
  })
})
