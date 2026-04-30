import Anthropic from '@anthropic-ai/sdk'
import { getSetting } from '../db'
import type { ParsedTransaction } from '../types'

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', desc: 'Fastest · lowest cost · good for clear bills' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Balanced · handles complex layouts well' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', desc: 'Most capable · highest cost' },
] as const

export type ClaudeModelId = typeof CLAUDE_MODELS[number]['id']
export const DEFAULT_MODEL: ClaudeModelId = 'claude-sonnet-4-6'

async function getModel(): Promise<string> {
  return (await getSetting('claude_model')) ?? DEFAULT_MODEL
}

const PDF_PROMPT = `You are parsing a BCA (Bank Central Asia) Indonesia credit card statement.
The text contains transaction rows in this format:
  DD-MON DD-MON DESCRIPTION AMOUNT [CR]

Where:
- First DD-MON is transaction date, second is booking date (ignore booking date)
- DESCRIPTION is the merchant/description
- AMOUNT uses Indonesian format: dots as thousands separators (e.g. "1.458.000" = 1458000)
- [CR] suffix means credit (negative)

The bill year comes from the header line "TANGGAL REKENING : DD BULAN YYYY".

Extract ALL individual transaction rows. Return ONLY a valid JSON array, no markdown, no explanation.

Each object in the array:
{
  "date": "YYYY-MM-DD",
  "description": "original description text",
  "amount": <integer in IDR, positive=charge, negative=credit>,
  "type": "<see rules below>"
}

Type rules (apply in order):
1. Contains "REVERSAL CICILAN" → "reversal", amount is negative (CR)
2. Contains "CICILAN BCA KE" → "installment"
3. Contains "PEMBAYARAN" → "payment", amount is negative
4. Contains "BIAYA BUNGA" → "interest"
5. Contains "BEA METERAI" → "fee"
6. Has CR suffix and not matched above → "refund", amount is negative
7. Otherwise → "purchase"

SKIP these lines entirely: headers, column titles, SALDO SEBELUMNYA, SUBTOTAL, TOTAL,
summary table rows, bank info, promo text, page numbers.

Return ONLY the JSON array.`

const IMAGE_PROMPT = `You are parsing a screenshot from BCA Mobile app showing credit card transactions (unbilled).
Each transaction shows: date (e.g. "14 Apr 2026"), merchant name, amount (e.g. "IDR 7,000.00"), card name.

Extract all visible transactions. Return ONLY a valid JSON array, no markdown, no explanation.

Each object:
{
  "date": "YYYY-MM-DD",
  "description": "merchant name exactly as shown",
  "amount": <integer IDR, positive=charge, negative=payment>,
  "type": "<see rules>"
}

Type rules:
- "PEMBAYARAN - MBCA" or "PEMBAYARAN - MYBCA" → "payment", amount negative
- Contains "CICILAN BCA KE" → "installment"
- Otherwise → "purchase"

Return ONLY the JSON array.`

export async function parsePDFText(text: string): Promise<ParsedTransaction[]> {
  const apiKey = await getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key not set. Go to Settings first.')

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const message = await client.messages.create({
    model: await getModel(),
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `${PDF_PROMPT}\n\nStatement text:\n${text}`,
      },
    ],
  })

  return parseClaudeResponse(message)
}

export async function parseImageFile(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
): Promise<ParsedTransaction[]> {
  const apiKey = await getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key not set. Go to Settings first.')

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const message = await client.messages.create({
    model: await getModel(),
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_PROMPT },
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
        ],
      },
    ],
  })

  return parseClaudeResponse(message)
}

function parseClaudeResponse(message: Anthropic.Message): ParsedTransaction[] {
  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  let parsed: ParsedTransaction[]
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`AI returned invalid JSON. Raw response:\n${text.slice(0, 300)}`)
  }

  if (!Array.isArray(parsed)) throw new Error('AI response is not an array')

  return parsed.filter(
    (t) =>
      typeof t.date === 'string' &&
      typeof t.description === 'string' &&
      typeof t.amount === 'number' &&
      typeof t.type === 'string'
  )
}

export function detectReversalPairs(
  transactions: ParsedTransaction[]
): ParsedTransaction[] {
  const result = transactions.map((t) => ({ ...t, _hide: false }))

  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== 'reversal' || result[i]._hide) continue
    const reversalAmt = Math.abs(result[i].amount)

    // Find the original purchase charge that was reversed (same abs amount, type purchase)
    const matchIdx = result.findIndex(
      (t, idx) =>
        idx !== i &&
        !t._hide &&
        t.type === 'purchase' &&
        Math.abs(t.amount) === reversalAmt
    )
    if (matchIdx >= 0) {
      result[i]._hide = true
      result[matchIdx]._hide = true
    }
  }

  return result.map(({ _hide, ...t }) => ({ ...t, _hidden: _hide })) as unknown as ParsedTransaction[]
}
