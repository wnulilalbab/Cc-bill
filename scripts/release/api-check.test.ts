import { describe, expect, it, vi } from 'vitest'
import { apiCheck, MODEL } from './api-check'

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
