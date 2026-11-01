import { describe, expect, it } from 'vitest'
import { billed, ledger, unbilled } from '../../test/domain/builders'
import { billedOf, latestBilled, previousBilled, statementById, statementSortKey } from './statements'

const l = ledger({
  statements: [
    billed('oct', '2026-10-12', '2026-10-28'),
    unbilled(),
    billed('aug', '2026-08-12', '2026-08-28'),
    billed('sep', '2026-09-12', '2026-09-28'),
    billed('m-oct', '2026-10-11', '2026-10-31', 'm'),
  ],
})

describe('statement helpers', () => {
  it('M-D-06 lists a card\'s billed statements oldest first, ignoring other cards and Unbilled', () => {
    expect(billedOf(l, 'c').map((s) => s.id)).toEqual(['aug', 'sep', 'oct'])
    expect(billedOf(l, 'm').map((s) => s.id)).toEqual(['m-oct'])
    expect(billedOf(l, 'none')).toEqual([])
  })

  it('M-D-07 finds the latest and the previous billed statement', () => {
    expect(latestBilled(l, 'c')?.id).toBe('oct')
    expect(latestBilled(l, 'none')).toBeUndefined()
    expect(previousBilled(l, statementById(l, 'oct')!)?.id).toBe('sep')
    expect(previousBilled(l, statementById(l, 'aug')!)).toBeUndefined()
    expect(previousBilled(l, statementById(l, 'unb')!)?.id).toBe('oct')
  })

  it('M-D-08 sorts Unbilled after every billed statement', () => {
    expect(statementSortKey(statementById(l, 'sep')!)).toBe('2026-09-12')
    expect(statementSortKey(statementById(l, 'unb')!)).toBe('9999-12-31')
    expect(statementById(l, 'nope')).toBeUndefined()
  })
})
