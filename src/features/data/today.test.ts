import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from '../bill/useBill'
import { localIsoDate } from './today'

const tz = process.env.TZ
afterEach(() => {
  process.env.TZ = tz
  vi.useRealTimers()
})

describe('local date', () => {
  it('uses the device\'s local calendar date, not UTC (Jakarta before 07:00 is already the next day)', () => {
    process.env.TZ = 'Asia/Jakarta'
    const d = new Date('2026-10-31T20:30:00Z')
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-31')
    expect(localIsoDate(d)).toBe('2026-11-01')
    process.env.TZ = 'America/Los_Angeles'
    expect(localIsoDate(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-31')
    process.env.TZ = 'UTC'
    expect(localIsoDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05')
  })

  it('"As of" today on Bill is the local date', () => {
    process.env.TZ = 'Asia/Jakarta'
    vi.useFakeTimers({ now: new Date('2026-11-30T18:00:00Z') })
    expect(todayIso()).toBe('2026-12-01')
    expect(localIsoDate()).toBe('2026-12-01')
  })
})
