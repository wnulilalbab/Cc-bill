// Minimal live check of the Anthropic API for the Release workflow. Fails (exit 1) on any error.
// Slice 6 extends this to parse the synthetic statements through the real import pipeline.
import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-haiku-4-5'

export async function apiCheck(apiKey: string | undefined, client?: Pick<Anthropic, 'messages'>): Promise<string> {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY_CI is empty. Set it in the "release" environment secrets.')
  const anthropic = client ?? new Anthropic({ apiKey })
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  if (!text) throw new Error('Anthropic API answered with no text')
  return text
}

if (process.argv[1]?.endsWith('scripts/release/api-check.ts')) {
  apiCheck(process.env.ANTHROPIC_API_KEY_CI).then(
    (text) => console.log(`Anthropic API OK (${MODEL}): ${JSON.stringify(text)}`),
    (e: unknown) => {
      console.error(`::error::Anthropic API check failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    },
  )
}
