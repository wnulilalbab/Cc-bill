// Import test helpers: synthetic fixtures, recorded (synthetic) AI answers built from each fixture's expected result,
// a mocked fetch, and seeded cards. The real API is never called in tests.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { vi } from 'vitest'
import type { AiConfig, FetchLike } from '../../src/ai/client'
import type { AiStatement } from '../../src/ai/schema'
import { saveCard } from '../../src/data/cards'
import type { NewDb } from '../../src/data/db'
import { commitImport } from '../../src/import/commit'
import { decideDuplicate, setTypedTotal, type ImportDraft, type ImportTarget } from '../../src/import/draft'
import type { PdfJsLike } from '../../src/import/pdf'
import { readImport, type ImportFile } from '../../src/import/read'
import household from '../fixtures/household.json'

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures')
export const pdfjsLib = pdfjs as unknown as PdfJsLike

export interface ExpectedRow {
  txDate: string
  postDate: string
  description: string
  amount: number
  kind: string
  installment?: { n: number; of: number }
}
export interface Expected {
  file: string
  card: 'bca' | 'mandiri'
  format?: 'pdf' | 'screenshots'
  statementDate?: string
  dueDate?: string
  printed?: { prevBalance: number; credits: number; purchases: number; feesInterest: number; newBalance: number; minPayment: number }
  rows: ExpectedRow[]
  expectedDifference?: number
}

export const expected = (path: string): Expected => JSON.parse(readFileSync(join(FIXTURES, `${path}.expected.json`), 'utf8'))

export function fileOf(path: string, name?: string): ImportFile {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, path)))
  const fileName = name ?? path.split('/').pop()!
  return { name: fileName, type: fileName.endsWith('.pdf') ? 'application/pdf' : 'image/png', bytes }
}

/** The answer a correct AI would give for a fixture (what a recorded response holds). */
export function aiAnswerFor(e: Expected, page = 0): AiStatement {
  const statement = e.statementDate !== undefined
  return {
    statementDate: e.statementDate ?? null,
    dueDate: e.dueDate ?? null,
    totals: statement
      ? { ...e.printed!, ...(e.format === 'screenshots' ? { credits: null, purchases: null, feesInterest: null, minPayment: null } : {}) }
      : { prevBalance: null, credits: null, purchases: null, feesInterest: null, newBalance: null, minPayment: null },
    rows: e.rows.map((r) => ({ page, date: r.txDate, postDate: r.postDate, description: r.description, amount: Math.abs(r.amount), credit: r.amount < 0 })),
  }
}

/** A Messages API response with `text` as the answer. */
export const apiResponse = (text: string, extra: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra }),
})

/** fetch that answers each call with the next answer (objects are JSON-encoded). */
export function mockFetch(...answers: (unknown | string)[]) {
  const queue = [...answers]
  return vi.fn<FetchLike>(async () => {
    if (!queue.length) throw new Error('unexpected extra AI call')
    const a = queue.shift()
    return apiResponse(typeof a === 'string' ? a : JSON.stringify(a))
  })
}

export const TEST_KEY = 'sk-ant-test-0000-synthetic-key'
export const aiConfig = (fetch: FetchLike): AiConfig => ({ apiKey: TEST_KEY, model: 'claude-opus-5-5', fetch })

export interface Seeded {
  bca: string
  mandiri: string
  owners: Record<string, Record<string, string>>
}

/** The fictional household's two cards with their owners and default owners. */
export async function seedCards(db: NewDb): Promise<Seeded> {
  const out: Seeded = { bca: '', mandiri: '', owners: {} }
  for (const key of ['bca', 'mandiri'] as const) {
    const c = household.cards[key]
    const id = await saveCard(db, {
      name: c.name,
      bank: c.bank,
      last4: c.masked.slice(-4),
      statementDay: key === 'bca' ? '12' : '11',
      palette: 'blue',
      owners: c.owners.map((name) => ({ name, color: '#000' })),
      defaultIndex: c.owners.indexOf(c.defaultOwner),
    })
    out[key] = id
    const owners = await db.owners.where('cardId').equals(id).toArray()
    out.owners[key] = Object.fromEntries(owners.map((o) => [o.name, o.id]))
  }
  return out
}

export interface ImportOptions {
  target?: ImportTarget
  files?: ImportFile[]
  password?: string
  typedTotal?: number
  duplicates?: 'keep' | 'skip'
  answer?: AiStatement
  page?: (e: Expected) => AiStatement
  /** Confirm saving although the totals differ. */
  acceptDifference?: boolean
}

/** Reads a fixture with a mocked AI answering from its expected file, answers the questions, saves. */
export async function importFixture(db: NewDb, cardId: string, path: string, opts: ImportOptions = {}) {
  const e = expected(path.replace(/(-p1)?\.(pdf|png)$/, ''))
  const fetch = mockFetch(opts.answer ?? aiAnswerFor(e))
  const target = opts.target ?? (e.statementDate ? 'statement' : 'unbilled')
  let draft: ImportDraft = await readImport(
    { db, ai: aiConfig(fetch), pdfjs: pdfjsLib },
    { cardId, target, files: opts.files ?? [fileOf(path)], password: opts.password ?? (e.card === 'mandiri' && path.endsWith('.pdf') ? household.password : undefined) },
  )
  if (draft.format === 'screenshots' && draft.target === 'statement') draft = setTypedTotal(draft, opts.typedTotal ?? e.printed!.newBalance)
  for (const q of draft.duplicates) draft = decideDuplicate(draft, q.rowKey, opts.duplicates ?? 'keep')
  const report = await commitImport(db, draft, { acceptDifference: opts.acceptDifference })
  return { draft, report, fetch, expected: e }
}
