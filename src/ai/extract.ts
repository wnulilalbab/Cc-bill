// One AI call per import, cached by file hash + prompt version in the new database's meta table (src/data/aiCache.ts).
import { AI_CACHE_PREFIX } from '../data/aiCache'
import type { NewDb } from '../data/db'
import { sendMessages, type AiConfig } from './client'
import { buildRequest, PROMPT_VERSION, type AiInput } from './prompt'
import { parseAiAnswer, validateAiStatement, type AiStatement } from './schema'

export interface CachedAnswer {
  savedAt: string
  model: string
  answer: AiStatement
}

export const cacheKey = (fileHash: string) => `${AI_CACHE_PREFIX}${fileHash}:${PROMPT_VERSION}`

/** SHA-256 (hex) of one or more files, in order. */
export async function hashFiles(files: readonly Uint8Array[]): Promise<string> {
  const total = files.reduce((n, f) => n + f.length + 8, 0)
  const all = new Uint8Array(total)
  let at = 0
  for (const f of files) {
    new DataView(all.buffer).setFloat64(at, f.length) // length prefix: [ab][c] never hashes like [a][bc]
    all.set(f, at + 8)
    at += f.length + 8
  }
  const digest = await crypto.subtle.digest('SHA-256', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ExtractResult {
  answer: AiStatement
  fromCache: boolean
}

/** Reads a statement with the AI, or returns the cached answer for the same file and prompt version. */
export async function extractStatement(db: NewDb, config: AiConfig, fileHash: string, input: AiInput): Promise<ExtractResult> {
  const key = cacheKey(fileHash)
  const cached = (await db.meta.get(key))?.value as CachedAnswer | undefined
  if (cached) {
    try {
      return { answer: validateAiStatement(cached.answer), fromCache: true }
    } catch {
      await db.meta.delete(key) // a damaged entry is dropped and the file read again
    }
  }
  const text = await sendMessages(config, buildRequest(input, config.model))
  const answer = parseAiAnswer(text)
  const value: CachedAnswer = { savedAt: new Date().toISOString(), model: config.model, answer }
  await db.meta.put({ key, value })
  return { answer, fromCache: false }
}

/** Base64 of bytes (browser and Node). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
