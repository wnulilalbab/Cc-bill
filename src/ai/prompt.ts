// The single AI request of an import: statement text (from a PDF, personal details already removed on the device)
// or screenshots, plus the output schema. Cached answers are keyed by PROMPT_VERSION, which is derived from the
// prompt and the schema: any change to either makes a new version, so stale answers are never reused.
import { AI_SCHEMA } from './schema'

export type AiInput =
  | { kind: 'text'; text: string }
  | { kind: 'images'; images: { mediaType: ImageMediaType; base64: string }[] }

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export const SYSTEM_PROMPT = `You read Indonesian credit card statements (BCA, Mandiri and similar) and bank-app screenshots, and return every transaction line as JSON matching the given schema. Copy, do not interpret.

Rows
- One row per printed transaction line, in printed order, from every page or image. Two identical lines are two rows.
- Skip everything that is not a transaction: headers, column titles, previous balance lines (SALDO SEBELUMNYA, Tagihan Bulan Lalu), subtotals and totals, summaries, page numbers, promotions.
- page: for text, the number n of the nearest "--- PAGE n ---" marker above the row; for screenshots, the 0-based index of the image the row is on.
- date: transaction date; postDate: booking date (the same as date if only one date is shown). Format YYYY-MM-DD. When the line has no year, take it from the statement date: a month after the statement month belongs to the previous year.
- description: exactly as printed, including installment markers such as "CICILAN BCA KE 01 DARI 06" or "002/003".
- amount: positive whole rupiah. Indonesian amounts use dots for thousands ("1.900.000" = 1900000); "1,900,000.00" = 1900000.
- credit: true for credit lines (marked CR, or payments, refunds and reversals shown as money coming in, e.g. "+Rp" or green). In bank-app screenshots charges may be shown with a minus sign: they are not credits.

Totals and dates (as printed; null when not shown)
- statementDate (Tanggal Rekening / Tanggal Cetak / Statement Date) and dueDate (Jatuh Tempo / Due Date), YYYY-MM-DD.
- prevBalance (previous balance), credits (payments and credits), purchases, feesInterest (fees, stamp duty and interest), newBalance (new balance / total bill), minPayment: positive whole rupiah.`

const USER_TEXT = 'Read this statement. Personal details were removed on the device.'
const USER_IMAGES = 'Read these screenshots, in order.'

/** FNV-1a (32-bit), hex. Not for security: only to notice that the prompt changed. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

export const PROMPT_VERSION = `import-${fnv1a([SYSTEM_PROMPT, USER_TEXT, USER_IMAGES, JSON.stringify(AI_SCHEMA)].join('\u0000'))}`

export interface MessagesRequest {
  model: string
  max_tokens: number
  system: string
  messages: { role: 'user'; content: unknown[] }[]
  output_config: { format: { type: 'json_schema'; schema: typeof AI_SCHEMA } }
}

export function buildRequest(input: AiInput, model: string): MessagesRequest {
  const content =
    input.kind === 'text'
      ? [{ type: 'text', text: `${USER_TEXT}\n\n${input.text}` }]
      : [
          ...input.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
          { type: 'text', text: USER_IMAGES },
        ]
  return {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: AI_SCHEMA } },
  }
}
