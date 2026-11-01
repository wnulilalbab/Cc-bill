// Sets the `review-gate` commit status on the PR head SHA. Runs in .github/workflows/review-gate.yml.
// All inputs arrive through environment variables / the event payload file; nothing is interpolated into a shell.
import { readFileSync } from 'node:fs'
import { decide, type GateComment } from './decide'

export const CONTEXT = 'review-gate'

/** PR number from a `pull_request` or `issue_comment` event payload; undefined for comments on plain issues. */
export function prNumberFromEvent(event?: {
  pull_request?: { number?: number }
  issue?: { number?: number; pull_request?: unknown }
}): number | undefined {
  if (event?.pull_request?.number) return event.pull_request.number
  if (event?.issue?.number && event.issue.pull_request) return event.issue.number
  return undefined
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

async function paginate<T>(token: string, path: string): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; page <= 50; page++) {
    const items = await api<T[]>(token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!token || !repo || !eventPath) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required')

  const number = prNumberFromEvent(JSON.parse(readFileSync(eventPath, 'utf8')))
  if (!number) {
    console.log('Event is not about a pull request; nothing to do.')
    return
  }

  const pr = await api<{ head: { sha: string }; state: string }>(token, `/repos/${repo}/pulls/${number}`)
  if (pr.state !== 'open') {
    console.log(`PR #${number} is ${pr.state}; nothing to do.`)
    return
  }
  const headSha = pr.head.sha

  const rawComments = await paginate<{ id: number; body: string | null; author_association: string }>(
    token,
    `/repos/${repo}/issues/${number}/comments`,
  )
  const comments: GateComment[] = rawComments.map((c) => ({
    id: c.id,
    body: c.body ?? '',
    authorAssociation: c.author_association,
  }))
  const files = await paginate<{ filename: string; previous_filename?: string }>(token, `/repos/${repo}/pulls/${number}/files`)
  const changedFiles = files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]))

  const result = decide({ headSha, comments, changedFiles })
  console.log(`PR #${number} @ ${headSha}: ${result.state} - ${result.description}`)

  await api(token, `/repos/${repo}/statuses/${headSha}`, {
    method: 'POST',
    body: JSON.stringify({ state: result.state, context: CONTEXT, description: result.description }),
  })
}

if (process.argv[1]?.endsWith('scripts/review-gate/run.ts')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
