// Live checks of the Anthropic API for the Release workflow (never in CI). Fails (exit 1) on any error.
// 1. A tiny ping.  2. One synthetic statement parsed through the real import pipeline (redaction, the one AI request
//    with the app's prompt and schema, validation, normalisation, totals check) must give the expected rows and totals.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { sendMessages, type FetchLike } from '../../src/ai/client'
import { buildRequest } from '../../src/ai/prompt'
import { parseAiAnswer } from '../../src/ai/schema'
import { reconcile } from '../../src/domain/reconcile'
import { normalizeRows, statementRows } from '../../src/import/normalize'
import { readPdfPages, type PdfJsLike } from '../../src/import/pdf'
import { redactStatement } from '../../src/import/redact'

export const MODEL = 'claude-haiku-4-5'
/** The parse check uses the app's default model (DEFAULT_AI_MODEL in src/features/settings/aiSettings.ts): the one users run. */
export const PARSE_MODEL = 'claude-opus-5-5'
export const PARSE_FIXTURE = 'statements/bca-2026-10'
const FIXTURES = join(import.meta.dirname, '../../test/fixtures')

export async function apiCheck(apiKey: string | undefined, client?: Pick<Anthropic, 'messages'>): Promise<string> {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY_CI is empty. Set it in the "release" environment secrets.')
  const anthropic = client ?? new Anthropic({ apiKey })
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  if (!text) throw new Error('Anthropic API answered with no text')
  return text
}

interface ExpectedFile {
  statementDate: string
  dueDate: string
  printed: { prevBalance: number; credits: number; purchases: number; feesInterest: number; newBalance: number; minPayment?: number }
  rows: { txDate: string; description: string; amount: number; kind: string }[]
}

const key = (r: { date: string; amount: number; kind: string }) => `${r.date}|${r.amount}|${r.kind}`

/** Parses one synthetic statement with the real API and checks it against its expected-result file. */
export async function parseCheck(apiKey: string | undefined, fetch?: FetchLike): Promise<string> {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY_CI is empty. Set it in the "release" environment secrets.')
  const e = JSON.parse(readFileSync(join(FIXTURES, `${PARSE_FIXTURE}.expected.json`), 'utf8')) as ExpectedFile
  const pages = await readPdfPages(pdfjs as unknown as PdfJsLike, new Uint8Array(readFileSync(join(FIXTURES, `${PARSE_FIXTURE}.pdf`))))
  const text = await sendMessages({ apiKey, model: PARSE_MODEL, fetch }, buildRequest({ kind: 'text', text: redactStatement(pages) }, PARSE_MODEL))
  const answer = parseAiAnswer(text)
  const rows = normalizeRows(answer.rows)

  const problems: string[] = []
  if (answer.statementDate !== e.statementDate) problems.push(`statement date ${answer.statementDate} ≠ ${e.statementDate}`)
  if (answer.dueDate !== e.dueDate) problems.push(`due date ${answer.dueDate} ≠ ${e.dueDate}`)
  for (const k of ['prevBalance', 'newBalance'] as const) if (answer.totals[k] !== e.printed[k]) problems.push(`${k} ${answer.totals[k]} ≠ ${e.printed[k]}`)
  const got = rows.map((r) => key(r)).sort()
  const want = e.rows.map((r) => key({ date: r.txDate, amount: r.amount, kind: r.kind })).sort()
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`rows differ: got ${got.length} [${got.join(', ')}], want ${want.length} [${want.join(', ')}]`)
  const check = reconcile(e.printed, statementRows(rows))
  if (!check.ok) problems.push(`totals check off by ${check.difference}`)
  if (problems.length) throw new Error(`${PARSE_FIXTURE} parsed wrongly: ${problems.join('; ')}`)
  return `${PARSE_FIXTURE}: ${rows.length} rows, totals match`
}

if (process.argv[1]?.endsWith('scripts/release/api-check.ts')) {
  const key = process.env.ANTHROPIC_API_KEY_CI
  apiCheck(key)
    .then((text) => console.log(`Anthropic API OK (${MODEL}): ${JSON.stringify(text)}`))
    .then(() => parseCheck(key))
    .then((summary) => console.log(`Statement parse OK (${PARSE_MODEL}): ${summary}`))
    .catch((e: unknown) => {
      console.error(`::error::Anthropic API check failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    })
}
