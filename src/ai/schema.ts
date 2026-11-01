// The one JSON shape the AI returns for a statement, a set of statement screenshots or Unbilled screenshots,
// and the on-device check that every answer passes before anything else reads it.
// Amounts are positive integer rupiah with a separate `credit` flag: banks print credits as "CR", "+" or green, and
// bank apps even show charges as negative, so the sign is decided on the device from the flag, never by the AI.

export interface AiRow {
  /** 0-based page (PDF) or image (screenshots) the row was read from. */
  page: number
  /** Transaction date, YYYY-MM-DD. */
  date: string
  /** Booking date, YYYY-MM-DD; the transaction date when the bank does not print one. */
  postDate: string
  description: string
  /** Positive integer rupiah. */
  amount: number
  /** A credit (CR) line: payment, refund, reversal. */
  credit: boolean
}

/** Totals as printed by the bank; `null` when not on the page. Positive integer rupiah. */
export interface AiTotals {
  prevBalance: number | null
  credits: number | null
  purchases: number | null
  feesInterest: number | null
  newBalance: number | null
  minPayment: number | null
}

export interface AiStatement {
  /** YYYY-MM-DD or null (Unbilled screenshots have none). */
  statementDate: string | null
  dueDate: string | null
  totals: AiTotals
  rows: AiRow[]
}

export class AiResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiResponseError'
  }
}

const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] }
const nullableDate = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] }
const TOTAL_KEYS = ['prevBalance', 'credits', 'purchases', 'feesInterest', 'newBalance', 'minPayment'] as const

/** JSON schema sent as the structured-output format (output_config.format). */
export const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['statementDate', 'dueDate', 'totals', 'rows'],
  properties: {
    statementDate: nullableDate,
    dueDate: nullableDate,
    totals: {
      type: 'object',
      additionalProperties: false,
      required: [...TOTAL_KEYS],
      properties: Object.fromEntries(TOTAL_KEYS.map((k) => [k, nullableInt])),
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'date', 'postDate', 'description', 'amount', 'credit'],
        properties: {
          page: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          postDate: { type: 'string', format: 'date' },
          description: { type: 'string' },
          amount: { type: 'integer' },
          credit: { type: 'boolean' },
        },
      },
    },
  },
} as const

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

/** A real calendar date as YYYY-MM-DD (a longer ISO timestamp is cut to its date), or null. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = ISO_DATE.exec(v.trim())
  if (!m) return null
  const d = new Date(`${m[0]}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0] ? m[0] : null
}

/**
 * Whole rupiah from a number or printed text: 1900000, "1.900.000", "1,900,000.00", "Rp 9.000", "-75.000".
 * Returns null when it is not an amount. The sign is dropped (the caller keeps it if it needs it).
 */
export function rupiahOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(Math.round(v)) : null
  if (typeof v !== 'string') return null
  let s = v.replace(/^\s*-?\s*(rp|idr)?\.?\s*/i, '').replace(/\s*(CR|DB)\s*$/i, '').trim()
  s = s.replace(/[.,]\d{2}$/, '') // cents: ",00" / ".00"
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(s)) return null
  return Number(s.replace(/[.,]/g, ''))
}

function creditOf(v: unknown, amount: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'cr', 'credit', 'yes'].includes(s)) return true
    if (['false', 'db', 'debit', 'no', ''].includes(s)) return false
  }
  if (v === undefined || v === null) {
    if (typeof amount === 'number') return amount < 0
    if (typeof amount === 'string') return /^\s*-|CR\s*$/i.test(amount)
  }
  return null
}

/** Removes Markdown fences and any prose around the JSON object. */
export function jsonText(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, '').trim()
  const first = unfenced.search(/[[{]/)
  const last = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'))
  return first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Parses and checks an AI answer. Repairs what is safe to repair (fences, amounts as text, negative amounts,
 * a missing booking date, a bare list of rows) and rejects everything else with a readable message.
 */
export function parseAiAnswer(text: string): AiStatement {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText(text))
  } catch {
    throw new AiResponseError('The AI answer was not valid JSON, so nothing was imported. Try again.')
  }
  return validateAiStatement(raw)
}

export function validateAiStatement(raw: unknown): AiStatement {
  const obj: Record<string, unknown> | null = Array.isArray(raw) ? { rows: raw } : isObject(raw) ? raw : null
  if (!obj) throw new AiResponseError('The AI answer is not a statement (expected an object with rows).')
  if (!Array.isArray(obj.rows)) throw new AiResponseError('The AI answer has no list of rows.')

  const rows = obj.rows.map((r, i): AiRow => {
    const where = `Row ${i + 1}`
    if (!isObject(r)) throw new AiResponseError(`${where} of the AI answer is not a row.`)
    const date = isoDate(r.date)
    if (!date) throw new AiResponseError(`${where} of the AI answer has no valid date (got ${JSON.stringify(r.date ?? null)}).`)
    const description = typeof r.description === 'string' ? r.description.replace(/\s+/g, ' ').trim() : ''
    if (!description) throw new AiResponseError(`${where} of the AI answer has no description.`)
    const amount = rupiahOf(r.amount)
    if (amount === null) throw new AiResponseError(`${where} (${description}) has no readable amount (got ${JSON.stringify(r.amount ?? null)}).`)
    const credit = creditOf(r.credit, r.amount)
    if (credit === null) throw new AiResponseError(`${where} (${description}) does not say whether it is a credit.`)
    const page = typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 0 ? r.page : 0
    return { page, date, postDate: isoDate(r.postDate) ?? date, description, amount, credit }
  })

  const t = isObject(obj.totals) ? obj.totals : {}
  const totals = Object.fromEntries(
    TOTAL_KEYS.map((k) => {
      const v = t[k]
      if (v === undefined || v === null) return [k, null]
      const n = rupiahOf(v)
      if (n === null) throw new AiResponseError(`The AI answer's printed ${k} is not an amount (got ${JSON.stringify(v)}).`)
      return [k, n]
    }),
  ) as unknown as AiTotals

  return { statementDate: isoDate(obj.statementDate), dueDate: isoDate(obj.dueDate), totals, rows }
}
