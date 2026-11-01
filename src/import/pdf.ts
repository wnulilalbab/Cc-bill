// Opens a statement PDF on the device (locked ones with their password) and returns the text of each page,
// one printed line per text line. pdf.js is passed in: the app loads the browser build, tests and scripts the Node one.

interface TextItemLike {
  str?: string
  transform?: number[]
}

export interface PdfDocLike {
  numPages: number
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItemLike[] }> }>
  destroy?(): Promise<void>
}

export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; password?: string; verbosity?: number }): { promise: Promise<PdfDocLike> }
}

export type PdfLockReason = 'needed' | 'wrong'

export class PdfPasswordError extends Error {
  constructor(readonly reason: PdfLockReason) {
    super(reason === 'needed' ? 'This PDF is locked. Type its password.' : "That password didn't open the file. Try again.")
    this.name = 'PdfPasswordError'
  }
}

export class PdfReadError extends Error {
  constructor(message = 'This file could not be read as a PDF.') {
    super(message)
    this.name = 'PdfReadError'
  }
}

/** pdf.js PasswordException codes. */
const NEED_PASSWORD = 1
const INCORRECT_PASSWORD = 2

/** Items on the same baseline (±3pt) form a line; lines top to bottom, items left to right. */
export function linesOf(items: readonly TextItemLike[]): string[] {
  const rows: { y: number; items: { x: number; s: string }[] }[] = []
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue
    const [x, y] = [it.transform[4], it.transform[5]]
    let row = rows.find((r) => Math.abs(r.y - y) <= 3)
    if (!row) rows.push((row = { y, items: [] }))
    row.items.push({ x, s: it.str.trim() })
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(' '),
    )
}

/** Text lines of every page. Throws PdfPasswordError for a locked file without (or with a wrong) password. */
export async function readPdfPages(lib: PdfJsLike, bytes: Uint8Array, password?: string): Promise<string[][]> {
  let doc: PdfDocLike
  try {
    // pdf.js takes ownership of the buffer it is given: pass a copy so a retry with another password still has the bytes.
    doc = await lib.getDocument({ data: bytes.slice(), password: password || undefined, verbosity: 0 }).promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === INCORRECT_PASSWORD ? 'wrong' : err.code === NEED_PASSWORD && password ? 'wrong' : 'needed')
    throw new PdfReadError()
  }
  const pages: string[][] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    pages.push(linesOf(content.items))
  }
  await doc.destroy?.()
  return pages
}
