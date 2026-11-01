import { describe, expect, it, vi } from 'vitest'
import { apiResponse, TEST_KEY } from '../../test/import/helpers'
import { AiRequestError, API_VERSION, MESSAGES_URL, sendMessages, type FetchLike } from './client'
import { buildRequest, fnv1a, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt'
import { AI_SCHEMA, AiResponseError } from './schema'

const body = buildRequest({ kind: 'text', text: 'LINES' }, 'claude-opus-5-5')
const answering = (res: Awaited<ReturnType<FetchLike>>) => vi.fn<FetchLike>(async () => res)
const status = (s: number) => ({ ok: false, status: s, json: async () => ({ error: { message: `key ${TEST_KEY} rejected` } }) })

describe('Claude Messages request', () => {
  it('builds one request with the system prompt, the redacted text and the strict output schema', () => {
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, system: SYSTEM_PROMPT, output_config: { format: { type: 'json_schema', schema: AI_SCHEMA } } })
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: expect.stringContaining('LINES') }] }])
    expect(PROMPT_VERSION).toMatch(/^import-[0-9a-f]{8}$/)
  })

  it('the prompt version is derived from the prompt and schema: any edit makes a new cache key', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(fnv1a(SYSTEM_PROMPT + ' ')).not.toBe(fnv1a(SYSTEM_PROMPT))
    expect(fnv1a(JSON.stringify({ ...AI_SCHEMA, required: [] }))).not.toBe(fnv1a(JSON.stringify(AI_SCHEMA)))
  })

  it('sends screenshots as base64 images in order, then the instruction', () => {
    const req = buildRequest({ kind: 'images', images: [{ mediaType: 'image/png', base64: 'AAA' }, { mediaType: 'image/jpeg', base64: 'BBB' }] }, 'm')
    expect(req.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
      { type: 'text', text: expect.any(String) },
    ])
  })

  it('posts with the browser-access header and the key, and returns the answer text', async () => {
    const fetch = answering(apiResponse('{"rows":[]}'))
    await expect(sendMessages({ apiKey: TEST_KEY, model: 'm', fetch }, body)).resolves.toBe('{"rows":[]}')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(MESSAGES_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': TEST_KEY,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(JSON.parse(init.body)).toEqual(body)
  })

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(apiResponse('ok') as unknown as Response)
    await expect(sendMessages({ apiKey: TEST_KEY, model: 'm' }, body)).resolves.toBe('ok')
    spy.mockRestore()
  })

  it('needs a key before calling', async () => {
    const fetch = answering(apiResponse('x'))
    await expect(sendMessages({ apiKey: '', model: 'm', fetch }, body)).rejects.toThrow('Add your Anthropic API key in Settings → AI first.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('turns HTTP and network failures into plain messages that never contain the key', async () => {
    const cases: [number, RegExp][] = [
      [401, /did not accept the API key/],
      [403, /did not accept the API key/],
      [404, /model .* is not available/],
      [413, /too large/],
      [429, /busy/],
      [529, /having trouble/],
      [400, /HTTP 400/],
    ]
    for (const [s, message] of cases) {
      const err = await sendMessages({ apiKey: TEST_KEY, model: 'm', fetch: answering(status(s)) }, body).catch((e: Error) => e)
      expect(err).toBeInstanceOf(AiRequestError)
      expect((err as AiRequestError).message).toMatch(message)
      expect((err as AiRequestError).status).toBe(s)
      expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(TEST_KEY)
    }
    const offline = vi.fn<FetchLike>(async () => {
      throw new Error(`failed with ${TEST_KEY}`)
    })
    const err = (await sendMessages({ apiKey: TEST_KEY, model: 'm', fetch: offline }, body).catch((e: Error) => e)) as Error
    expect(err.message).toBe('Could not reach the AI service. Check the connection and try again.')
    expect(err.message).not.toContain(TEST_KEY)
  })

  it('rejects refusals, cut-off answers and empty answers', async () => {
    const run = (res: Awaited<ReturnType<FetchLike>>) => sendMessages({ apiKey: TEST_KEY, model: 'm', fetch: answering(res) }, body)
    await expect(run(apiResponse('{}', { stop_reason: 'refusal' }))).rejects.toThrow(AiResponseError)
    await expect(run(apiResponse('{"rows":[', { stop_reason: 'max_tokens' }))).rejects.toThrow(/cut off/)
    await expect(run(apiResponse('  '))).rejects.toThrow(/no text/)
    await expect(run({ ok: true, status: 200, json: async () => ({ content: [{ type: 'thinking' }] }) })).rejects.toThrow(/no text/)
    await expect(run({ ok: true, status: 200, json: async () => Promise.reject(new Error('bad body')) })).rejects.toThrow(/no text/)
  })

  it('never logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    await sendMessages({ apiKey: TEST_KEY, model: 'm', fetch: answering(apiResponse('x')) }, body)
    await sendMessages({ apiKey: TEST_KEY, model: 'm', fetch: answering(status(401)) }, body).catch(() => {})
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    spies.forEach((s) => s.mockRestore())
  })
})
