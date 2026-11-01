import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AI_MODEL } from '../../src/features/settings/aiSettings'
import { aiAnswerFor, expected, mockFetch } from '../../test/import/helpers'
import { apiCheck, MODEL, PARSE_FIXTURE, PARSE_MODEL, parseCheck } from './api-check'

const fake = (content: unknown[]) => ({ messages: { create: vi.fn().mockResolvedValue({ content }) } }) as never

describe('apiCheck', () => {
  it('fails fast when the key is empty', async () => {
    await expect(apiCheck('')).rejects.toThrow(/ANTHROPIC_API_KEY_CI is empty/)
    await expect(apiCheck(undefined)).rejects.toThrow(/empty/)
  })
  it('sends a tiny request to claude-haiku-4-5 and returns the text', async () => {
    const client = fake([{ type: 'text', text: ' ok ' }]) as { messages: { create: ReturnType<typeof vi.fn> } }
    await expect(apiCheck('k', client as never)).resolves.toBe('ok')
    expect(client.messages.create).toHaveBeenCalledWith(expect.objectContaining({ model: MODEL, max_tokens: 16 }))
    expect(MODEL).toBe('claude-haiku-4-5')
  })
  it('fails when the answer has no text', async () => {
    await expect(apiCheck('k', fake([]))).rejects.toThrow(/no text/)
  })
  it('propagates API errors', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('401')) } } as never
    await expect(apiCheck('k', client)).rejects.toThrow('401')
  })
})

describe('parseCheck (Slice 6): one synthetic statement through the real pipeline', () => {
  const recorded = (mutate: (a: ReturnType<typeof aiAnswerFor>) => void = () => {}) => {
    const a = aiAnswerFor(expected(PARSE_FIXTURE))
    mutate(a)
    return mockFetch(a)
  }

  it('uses the app default model and passes when the answer matches the expected file', async () => {
    expect(PARSE_MODEL).toBe(DEFAULT_AI_MODEL)
    const fetch = recorded()
    await expect(parseCheck('k', fetch)).resolves.toBe('statements/bca-2026-10: 13 rows, totals match')
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.model).toBe(PARSE_MODEL)
    expect(body.messages[0].content[0].text).not.toContain('ANDI PRATAMA')
  })

  it('fails on an empty key, wrong dates, totals or rows', async () => {
    await expect(parseCheck(undefined)).rejects.toThrow(/empty/)
    await expect(
      parseCheck(
        'k',
        recorded((a) => {
          a.statementDate = '2026-10-11'
          a.dueDate = null
          a.totals.newBalance = 1
          a.rows[0].amount += 1
        }),
      ),
    ).rejects.toThrow(/statement date 2026-10-11 ≠ 2026-10-12; due date null ≠ 2026-10-28; newBalance 1 ≠ 3281096; rows differ: .*; totals check off by -1/)
  })
})
