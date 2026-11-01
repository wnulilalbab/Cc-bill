import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { aiAnswerFor, aiConfig, expected, mockFetch } from '../../test/import/helpers'
import { clearAiCache } from '../data/aiCache'
import { cacheKey, extractStatement, hashFiles, toBase64 } from './extract'
import { PROMPT_VERSION } from './prompt'

const input = { kind: 'text' as const, text: 'LINES' }

describe('one AI call per import, cached', () => {
  it('I-15 the same file and prompt version is answered from the cache: no second API call', async () => {
    const db = freshNewDb()
    const answer = aiAnswerFor(expected('statements/bca-2026-10'))
    const fetch = mockFetch(answer)
    const hash = await hashFiles([new Uint8Array([1, 2, 3])])
    const first = await extractStatement(db, aiConfig(fetch), hash, input)
    expect(first).toEqual({ answer, fromCache: false })
    const second = await extractStatement(db, aiConfig(fetch), hash, input)
    expect(second).toEqual({ answer, fromCache: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cacheKey(hash)).toBe(`ai-cache:${hash}:${PROMPT_VERSION}`)
    expect(await db.meta.get(cacheKey(hash))).toMatchObject({ value: { model: 'claude-opus-5-5', answer } })

    // A different file is a new call; clearing the cache (Testing tools) forces a new call too.
    const other = await hashFiles([new Uint8Array([1, 2, 4])])
    await extractStatement(db, aiConfig(mockFetch(answer)), other, input)
    expect(await clearAiCache(db)).toBe(2)
    const again = mockFetch(answer)
    expect((await extractStatement(db, aiConfig(again), hash, input)).fromCache).toBe(false)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('a damaged cache entry is dropped and the file read again', async () => {
    const db = freshNewDb()
    const hash = 'abc'
    await db.meta.put({ key: cacheKey(hash), value: { answer: { rows: 'broken' } } })
    const fetch = mockFetch({ rows: [] })
    expect((await extractStatement(db, aiConfig(fetch), hash, input)).fromCache).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an invalid answer is not cached', async () => {
    const db = freshNewDb()
    await expect(extractStatement(db, aiConfig(mockFetch('{"rows": 1}')), 'h', input)).rejects.toThrow(/no list of rows/)
    expect(await db.meta.count()).toBe(0)
  })

  it('hashes files in order, with boundaries', async () => {
    const a = await hashFiles([new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashFiles([new Uint8Array([1]), new Uint8Array([2, 3])])).not.toBe(a)
    expect(await hashFiles([new Uint8Array([3]), new Uint8Array([1, 2])])).not.toBe(a)
  })

  it('base64-encodes large files', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(Buffer.from(toBase64(big), 'base64').equals(Buffer.from(big))).toBe(true)
  })
})
