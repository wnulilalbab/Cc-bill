// Pure decision logic for the `review-gate` commit status (see docs/intent/dev-loop.md).
// No I/O here so it can be unit-tested exhaustively.

export type ReviewKind = 'senior' | 'security'
export type Verdict = 'approve' | 'request-changes'

export interface GateComment {
  id: number
  body: string
  /** GitHub `author_association` of the commenter. Only trusted associations may post markers. */
  authorAssociation: string
}

export interface GateResult {
  state: 'success' | 'pending' | 'failure'
  /** Max 140 chars (GitHub limit for status descriptions). */
  description: string
}

/** Reviewers act through the owner's account; anyone else (e.g. a drive-by commenter) cannot approve. */
export const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

const RISKY_PREFIXES = ['src/import/', 'src/ai/', 'src/data/', '.github/workflows/', 'scripts/review-gate/', 'scripts/release/', '.claude/']
const RISKY_EXACT = ['vite.config.ts', 'package.json', 'package-lock.json']

export function isRiskyPath(path: string): boolean {
  return (
    RISKY_PREFIXES.some((p) => path.startsWith(p)) ||
    RISKY_EXACT.includes(path) ||
    /password|crypto/i.test(path)
  )
}

export function needsSecurityReview(changedFiles: string[]): boolean {
  return changedFiles.some(isRiskyPath)
}

const MARKER = /<!--\s*review:(senior|security)\s+(approve|request-changes)\s+sha=([0-9a-fA-F]{40})\s*-->/g

export interface Marker {
  kind: ReviewKind
  verdict: Verdict
  sha: string
}

export function parseMarkers(body: string): Marker[] {
  return [...body.matchAll(MARKER)].map((m) => ({
    kind: m[1] as ReviewKind,
    verdict: m[2] as Verdict,
    sha: m[3].toLowerCase(),
  }))
}

/**
 * Latest verdict for `kind` on exactly `headSha`, or undefined when there is none.
 * Comments are ordered by id (creation order); within one comment, by position.
 * Markers for other SHAs are ignored, which is how a new commit invalidates earlier approvals.
 */
export function latestVerdict(comments: GateComment[], kind: ReviewKind, headSha: string): Verdict | undefined {
  const sha = headSha.toLowerCase()
  let verdict: Verdict | undefined
  const ordered = [...comments].sort((a, b) => a.id - b.id)
  for (const c of ordered) {
    if (!TRUSTED_ASSOCIATIONS.has(c.authorAssociation)) continue
    for (const m of parseMarkers(c.body)) {
      if (m.kind === kind && m.sha === sha) verdict = m.verdict
    }
  }
  return verdict
}

const cap = (s: string) => (s.length <= 140 ? s : s.slice(0, 137) + '...')

export function decide(input: { headSha: string; comments: GateComment[]; changedFiles: string[] }): GateResult {
  const { headSha, comments, changedFiles } = input
  const required: ReviewKind[] = needsSecurityReview(changedFiles) ? ['senior', 'security'] : ['senior']
  const verdicts = required.map((kind) => [kind, latestVerdict(comments, kind, headSha)] as const)

  const rejected = verdicts.filter(([, v]) => v === 'request-changes').map(([k]) => k)
  if (rejected.length > 0) {
    return { state: 'failure', description: cap(`Changes requested by ${rejected.join(' and ')} review on ${headSha.slice(0, 7)}`) }
  }
  const missing = verdicts.filter(([, v]) => v === undefined).map(([k]) => k)
  if (missing.length > 0) {
    return { state: 'pending', description: cap(`Waiting for ${missing.join(' and ')} approval of ${headSha.slice(0, 7)}`) }
  }
  return { state: 'success', description: cap(`${required.join(' + ')} approved ${headSha.slice(0, 7)}`) }
}
