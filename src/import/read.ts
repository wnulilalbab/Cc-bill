// Step 1 of an import: open the file(s) on the device, make the one AI call (or reuse its cached answer), and turn
// the answer into a draft for review. Nothing is written except the AI cache entry.
import type { AiConfig } from '../ai/client'
import { extractStatement, hashFiles, toBase64 } from '../ai/extract'
import type { AiInput, ImageMediaType } from '../ai/prompt'
import type { CardRecord } from '../data/cards'
import type { NewDb } from '../data/db'
import { billedOf } from '../domain/statements'
import { ImportError, mergeOverlaps, type DuplicateQuestion, type ImportDraft, type ImportTarget } from './draft'
import { monthFromFileName } from './month'
import { normalizeRows, rowIdentity, type DraftRow } from './normalize'
import { LIMITS, readPdfPages, type PdfJsLike } from './pdf'
import { printedBalances, redactStatement } from './redact'

export interface ImportFile {
  name: string
  /** MIME type as the browser reports it (may be empty). */
  type: string
  bytes: Uint8Array
}

export interface ReadRequest {
  cardId: string
  target: ImportTarget
  files: ImportFile[]
  /** For a locked PDF. */
  password?: string
}

export interface ImportDeps {
  db: NewDb
  ai: AiConfig
  /** pdf.js, needed for PDF files. */
  pdfjs?: PdfJsLike
}

export const IMPORT_META_PREFIX = 'import-file:'

const IMAGE_TYPES: Record<string, ImageMediaType> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const isPdf = (f: ImportFile) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
function imageType(f: ImportFile): ImageMediaType | null {
  if (Object.values(IMAGE_TYPES).includes(f.type as ImageMediaType)) return f.type as ImageMediaType
  return IMAGE_TYPES[/\.([a-z]+)$/i.exec(f.name)?.[1].toLowerCase() ?? ''] ?? null
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

export async function readImport(deps: ImportDeps, req: ReadRequest): Promise<ImportDraft> {
  const { db } = deps
  const card = await db.cards.get(req.cardId)
  if (!card) throw new ImportError('Pick a card first.')
  if (req.files.length === 0) throw new ImportError('Choose a file first.')

  const pdf = req.files.length === 1 && isPdf(req.files[0])
  const images = pdf ? [] : req.files.map((f) => ({ f, type: imageType(f) }))
  if (!pdf && images.some((i) => !i.type)) throw new ImportError('Choose one PDF statement, or screenshots (PNG or JPEG).')
  if (pdf && req.target === 'unbilled') throw new ImportError('Unbilled takes screenshots from the bank app, not a PDF.')

  if (images.length > LIMITS.images) throw new ImportError(`Choose at most ${LIMITS.images} screenshots at a time.`)
  const big = images.find((i) => i.f.bytes.length > LIMITS.imageBytes)
  if (big) throw new ImportError(`${big.f.name} is larger than ${LIMITS.imageBytes / 1024 / 1024} MB. Use a normal phone screenshot.`)

  let input: AiInput
  let deviceTotals: ImportDraft['deviceTotals']
  if (pdf) {
    if (!deps.pdfjs) throw new ImportError('The PDF reader is not available.')
    const text = redactStatement(await readPdfPages(deps.pdfjs, req.files[0].bytes, req.password), { last4: card.last4, holderName: (card as CardRecord).holderName })
    if (text.length > LIMITS.textChars) throw new ImportError('This PDF holds far more text than a card statement. Check the file.')
    input = { kind: 'text', text }
    deviceTotals = printedBalances(text)
  } else {
    input = { kind: 'images', images: images.map((i) => ({ mediaType: i.type!, base64: toBase64(i.f.bytes) })) }
  }
  const fileHash = await hashFiles(req.files.map((f) => f.bytes))
  const { answer, fromCache } = await extractStatement(db, deps.ai, fileHash, input)

  let rows: DraftRow[] = normalizeRows(answer.rows)
  let overlapMerged = 0
  if (!pdf) ({ rows, merged: overlapMerged } = mergeOverlaps(rows))

  const ledgerStatements = await db.statements.where('cardId').equals(card.id).toArray()
  const fromName = monthFromFileName(req.files[0].name)
  let statementDate: string | null = null
  if (req.target === 'statement') {
    // The printed date wins; the file name is the fallback (and a warning when the months disagree).
    statementDate = answer.statementDate ?? fromName?.date ?? null
    if (!statementDate && fromName) statementDate = `${fromName.month}-${pad(Math.min(card.statementDay ?? lastDay(fromName.month), lastDay(fromName.month)))}`
  }

  const printed = { ...answer.totals }
  if (req.target === 'statement' && printed.prevBalance === null && statementDate) {
    // Screenshots rarely show the previous balance: take the new balance of the statement before.
    const before = billedOf({ statements: ledgerStatements }, card.id).filter((s) => s.statementDate < statementDate!)
    printed.prevBalance = before.length ? before[before.length - 1].printed.newBalance : null
  }

  const draft: ImportDraft = {
    cardId: card.id,
    target: req.target,
    format: pdf ? 'pdf' : 'screenshots',
    fileNames: req.files.map((f) => f.name),
    fileHash,
    fromCache,
    statementDate,
    dueDate: req.target === 'statement' ? answer.dueDate : null,
    printed,
    typedTotal: null,
    rows,
    overlapMerged,
    duplicates: req.target === 'unbilled' ? await duplicateQuestions(db, card.id, rows) : [],
    warnings: [],
  }
  if (deviceTotals) draft.deviceTotals = deviceTotals
  if (req.target === 'statement' && answer.statementDate && fromName && fromName.month !== answer.statementDate.slice(0, 7))
    draft.warnings.push(`The file name says ${monthLabel(fromName.month)}, but the statement is dated ${monthLabel(answer.statementDate)}. The printed date is used.`)
  const seen = (await db.meta.get(`${IMPORT_META_PREFIX}${fileHash}`))?.value as ImportDraft['alreadyImported'] | undefined
  if (seen) draft.alreadyImported = seen
  if (statementDate) {
    const same = billedOf({ statements: ledgerStatements }, card.id).find((s) => s.statementDate.slice(0, 7) === statementDate!.slice(0, 7))
    if (same) draft.replaces = { statementId: same.id, statementDate: same.statementDate }
  }
  return draft
}

/**
 * Unbilled screenshots: a line that matches a stored one (same day, same amount, same merchant) is asked about —
 * "Keep both / Skip" — never skipped silently (phase-1 §4, I-11). Each stored line answers for one new line.
 */
export async function duplicateQuestions(db: NewDb, cardId: string, rows: readonly DraftRow[]): Promise<DuplicateQuestion[]> {
  const [txs, pays, statements] = await Promise.all([
    db.transactions.where('cardId').equals(cardId).toArray(),
    db.payments.where('cardId').equals(cardId).toArray(),
    db.statements.where('cardId').equals(cardId).toArray(),
  ])
  const where = (statementId: string | undefined) => {
    const s = statements.find((x) => x.id === statementId)
    return !s || s.kind === 'unbilled' ? 'Unbilled' : `the ${s.statementDate} statement`
  }
  const stored = [
    ...txs.map((t) => ({ id: t.id, key: `tx|${rowIdentity(t)}`, statementId: t.statementId as string | undefined })),
    ...pays.filter((p) => p.source !== 'manual').map((p) => ({ id: p.id, key: `pay|${p.date}|${p.amount}`, statementId: p.statementId })),
  ]
  const used = new Set<string>()
  const out: DuplicateQuestion[] = []
  for (const r of rows) {
    const key = r.kind === 'payment' ? `pay|${r.date}|${-r.amount}` : `tx|${rowIdentity(r)}`
    const hit = stored.find((s) => !used.has(s.id) && s.key === key)
    if (!hit) continue
    used.add(hit.id)
    out.push({ rowKey: r.key, existingId: hit.id, where: where(hit.statementId) })
  }
  return out
}
