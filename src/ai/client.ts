// Calls the Claude Messages API straight from the browser (fetch, no SDK: the key lives on this phone only).
// Error messages never contain the API key or the request body.
import type { MessagesRequest } from './prompt'
import { AiResponseError } from './schema'

export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const API_VERSION = '2023-06-01'

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface AiConfig {
  apiKey: string
  model: string
  fetch?: FetchLike
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AiRequestError'
  }
}

function httpMessage(status: number): string {
  if (status === 401 || status === 403) return 'The AI service did not accept the API key. Check it in Settings → AI.'
  if (status === 404) return 'The AI model in Settings → AI is not available. Pick another model.'
  if (status === 413) return 'The file is too large for one AI request. Try fewer screenshots.'
  if (status === 429) return 'The AI service is busy (rate limit). Wait a minute and try again.'
  if (status >= 500) return 'The AI service is having trouble right now. Try again in a few minutes.'
  return `The AI request failed (HTTP ${status}).`
}

/** Sends one Messages request and returns the text of the answer. */
export async function sendMessages(config: AiConfig, body: MessagesRequest): Promise<string> {
  if (!config.apiKey) throw new AiRequestError('Add your Anthropic API key in Settings → AI first.')
  const doFetch = config.fetch ?? (globalThis.fetch as unknown as FetchLike)
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await doFetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiRequestError('Could not reach the AI service. Check the connection and try again.')
  }
  if (!res.ok) throw new AiRequestError(httpMessage(res.status), res.status)

  const data = (await res.json().catch(() => null)) as { content?: { type?: string; text?: string }[]; stop_reason?: string } | null
  if (data?.stop_reason === 'refusal') throw new AiResponseError('The AI declined to read this file.')
  if (data?.stop_reason === 'max_tokens') throw new AiResponseError('The AI answer was cut off (too many rows for one request).')
  const text = (data?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  if (!text.trim()) throw new AiResponseError('The AI answered with no text.')
  return text
}
