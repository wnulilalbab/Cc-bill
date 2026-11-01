// The synthetic household's tagging setup (fictional): its cards and owners from test/fixtures/household.json,
// the few rules the user keeps, and the AI guesses an import would return for merchants seen for the first time.
import household from '../fixtures/household.json'
import bca07 from '../fixtures/statements/bca-2026-07.expected.json'
import bca08 from '../fixtures/statements/bca-2026-08.expected.json'
import bca09 from '../fixtures/statements/bca-2026-09.expected.json'
import bca10 from '../fixtures/statements/bca-2026-10.expected.json'
import bca11 from '../fixtures/statements/bca-2026-11.expected.json'
import mandiri08 from '../fixtures/screenshots/mandiri-2026-08.expected.json'
import mandiri09 from '../fixtures/screenshots/mandiri-2026-09.expected.json'
import mandiri10 from '../fixtures/statements/mandiri-2026-10.expected.json'
import mandiri11 from '../fixtures/statements/mandiri-2026-11.expected.json'
import type { Card, Owner, TxKind } from '../../src/domain/types'
import type { TagRule } from '../../src/domain/tagging/types'

export type CardKey = 'bca' | 'mandiri'

export interface ExpectedRow {
  txDate: string
  description: string
  amount: number
  kind: string
  expectedOwner: string | null
  needsCheck?: boolean
  reverses?: string
  installment?: { n: number; of: number; plan: string }
}

export interface ExpectedStatement {
  file: string
  card: string
  rows: ExpectedRow[]
}

export const ownerId = (card: CardKey, name: string) => `${card}-${name.toLowerCase()}`

export const cards: Record<CardKey, Card> = {
  bca: { id: 'bca', name: household.cards.bca.name, bank: 'BCA', defaultOwnerId: ownerId('bca', household.cards.bca.defaultOwner) },
  mandiri: { id: 'mandiri', name: household.cards.mandiri.name, bank: 'Mandiri', defaultOwnerId: ownerId('mandiri', household.cards.mandiri.defaultOwner) },
}

export const owners: Owner[] = (['bca', 'mandiri'] as const).flatMap((c) => household.cards[c].owners.map((name) => ({ id: ownerId(c, name), cardId: c, name })))

const rule = (id: string, cardId: CardKey, match: TagRule['match'], pattern: string, owner: string): TagRule => ({
  id, cardId, match, pattern, ownerId: ownerId(cardId, owner), updatedAt: '2026-06-01T00:00:00.000Z',
})

/** The rules the household keeps. Everything else is learned from history or guessed by the import's AI. */
export const rules: TagRule[] = [
  rule('r-grab', 'bca', 'startsWith', 'GRAB*', 'Andi'),
  rule('r-garmin', 'bca', 'contains', 'GARMIN', 'Andi'),
  rule('r-openai', 'mandiri', 'contains', 'OPENAI', 'Kantor'),
]

/** Recorded AI guesses by merchant (what the import's one AI request returns for each line), confident. */
export const aiGuesses: Record<CardKey, Record<string, string>> = {
  bca: {
    'GRAMEDIA MATRAMAN': 'Bima',
    'RS PONDOK INDAH': 'Medis',
    KIDZANIA: 'Bima',
    'BLIBLI SEPEDA STATIS': 'Sari',
    'WATSONS SENAYAN CITY': 'Sari',
    HALODOC: 'Medis',
  },
  mandiri: {
    'TOKO LILI': 'Rumah',
    'RK BUAH GROSIR': 'Rumah',
    'PONDOK SATE KAMBING MUDA': 'Rumah',
    NETFLIX: 'Rumah',
  },
}

/** Every statement with charges, oldest first per card. Payment lines are not tagged. */
export const statements: Record<CardKey, ExpectedStatement[]> = {
  bca: [bca07, bca08, bca09, bca10, bca11],
  mandiri: [mandiri08, mandiri09, mandiri10, mandiri11],
}

export const taggable = (r: ExpectedRow) => r.kind !== 'payment'
export const kindOf = (r: ExpectedRow) => r.kind as TxKind
