// Performance guard (deterministic): merchant names are normalized once per row and once per past label, however
// many rows follow links or look at history. Synthetic data only.
import { describe, expect, it, vi } from 'vitest'
import type { Card, Owner } from '../types'
import * as merchant from './merchant'
import { suggestOwners } from './suggest'
import type { LabelledRow, TagRow } from './types'

vi.mock('./merchant', async (importOriginal) => {
  const real = await importOriginal<typeof import('./merchant')>()
  return { ...real, normalizeMerchant: vi.fn(real.normalizeMerchant) }
})

const owners: Owner[] = [
  { id: 'a-andi', cardId: 'A', name: 'Andi' },
  { id: 'a-sari', cardId: 'A', name: 'Sari' },
]
const card: Card = { id: 'A', name: 'Card A', bank: 'BCA', defaultOwnerId: 'a-andi' }

describe('tagging cost', () => {
  it('200 rows against 5,000 past labels: one normalization per row, per label and per reversal target', () => {
    const shops = Array.from({ length: 50 }, (_, i) => `TOKO ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} JAKARTA`)
    const history: LabelledRow[] = Array.from({ length: 5000 }, (_, i) => ({
      description: shops[i % shops.length],
      kind: i % 10 === 0 ? 'installment' : 'purchase',
      amount: 1000 + (i % 7),
      date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
      ownerId: i % 3 ? 'a-andi' : 'a-sari',
    }))
    const rows: TagRow[] = Array.from({ length: 200 }, (_, i) => {
      const description = shops[i % shops.length]
      if (i % 4 === 1) return { description: `REFUND ${description}`, kind: 'refund', amount: -(1000 + (i % 7)), date: '2026-10-20' }
      if (i % 4 === 2) return { description: `REVERSAL CICILAN BCA ${description}`, kind: 'reversal', amount: -1003, date: '2026-10-20', reverses: description }
      if (i % 4 === 3) return { description: `CICILAN BCA KE 01 DARI 06, ${description}`, kind: 'installment', installment: { n: 1, of: 6 }, amount: 500, date: '2026-10-21' }
      return { description, kind: 'purchase', amount: 1000 + (i % 7), date: '2026-10-10' }
    })
    const spy = vi.mocked(merchant.normalizeMerchant)
    spy.mockClear()
    const out = suggestOwners(card, rows, history, { owners, rules: [] })
    expect(out).toHaveLength(200)
    const reversals = rows.filter((r) => r.reverses).length
    expect(spy).toHaveBeenCalledTimes(history.length + rows.length + reversals)
  })
})
