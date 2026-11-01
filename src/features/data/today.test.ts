import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from '../bill/useBill'
import { localIsoDate } from './today'

afterEach(() => vi.useRealTimers())

// A Date whose local calendar (as the device's timezone would report it) differs from its UTC calendar.
// Changing process.env.TZ at runtime is not honoured in every runner, so the local view is faked instead.
function localDate(utcIso: string, local: { y: number; m: number; d: number }): Date {
  const date = new Date(utcIso)
  vi.spyOn(date, 'getFullYear').mockReturnValue(local.y)
  vi.spyOn(date, 'getMonth').mockReturnValue(local.m - 1)
  vi.spyOn(date, 'getDate').mockReturnValue(local.d)
  return date
}

describe('local date', () => {
  it("uses the device's local calendar date, not UTC (Jakarta before 07:00 is already the next day)", () => {
    const jakarta = localDate('2026-10-31T20:30:00Z', { y: 2026, m: 11, d: 1 })
    expect(jakarta.toISOString().slice(0, 10)).toBe('2026-10-31')
    expect(localIsoDate(jakarta)).toBe('2026-11-01')
    expect(localIsoDate(localDate('2026-11-01T03:00:00Z', { y: 2026, m: 10, d: 31 }))).toBe('2026-10-31')
    expect(localIsoDate(localDate('2026-01-05T00:00:00Z', { y: 2026, m: 1, d: 5 }))).toBe('2026-01-05')
  })

  it('"As of" today on Bill is the local date', () => {
    vi.useFakeTimers({ now: new Date(2026, 11, 1, 1, 0, 0) }) // 01:00 local on 1 Dec, whatever the runner's timezone
    expect(todayIso()).toBe('2026-12-01')
    expect(localIsoDate()).toBe('2026-12-01')
  })
})
