import { describe, expect, it } from 'vitest'
import { decide, isRiskyPath, latestVerdict, needsSecurityReview, parseMarkers, type GateComment } from './decide'
import { prNumberFromEvent } from './run'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const m = (kind: string, verdict: string, sha = HEAD) => `<!-- review:${kind} ${verdict} sha=${sha} -->`
let nextId = 1
const c = (body: string, authorAssociation = 'OWNER'): GateComment => ({ id: nextId++, body, authorAssociation })
const SAFE = ['src/domain/money.ts', 'README.md']
const RISKY = ['src/import/parse.ts']

describe('isRiskyPath / needsSecurityReview', () => {
  it.each([
    'src/import/a.ts', 'src/ai/prompt.ts', 'src/data/db.ts', '.github/workflows/ci.yml',
    'vite.config.ts', 'package.json', 'package-lock.json',
    'src/lib/passwordStore.ts', 'src/lib/Crypto.ts', 'docs/crypto-notes.md',
    'scripts/review-gate/run.ts', 'scripts/release/api-check.ts', '.claude/settings.json',
  ])('%s is risky', (p) => expect(isRiskyPath(p)).toBe(true))

  it.each([
    'src/domain/money.ts', 'src/pages/Dashboard.tsx', 'README.md', 'src/importer.ts',
    'docs/package.json.md', 'test/vite.config.ts', 'scripts/fixtures/data.ts',
  ])('%s is not risky', (p) => expect(isRiskyPath(p)).toBe(false))

  it('flags a diff when any file is risky', () => {
    expect(needsSecurityReview(SAFE)).toBe(false)
    expect(needsSecurityReview([...SAFE, 'src/ai/x.ts'])).toBe(true)
    expect(needsSecurityReview([])).toBe(false)
  })
})

describe('parseMarkers', () => {
  it('reads several markers from one comment, case-insensitive sha', () => {
    const body = `LGTM\n${m('senior', 'approve', HEAD.toUpperCase())}\ntext ${m('security', 'request-changes')}`
    expect(parseMarkers(body)).toEqual([
      { kind: 'senior', verdict: 'approve', sha: HEAD },
      { kind: 'security', verdict: 'request-changes', sha: HEAD },
    ])
  })
  it('ignores malformed markers (short sha, unknown kind or verdict)', () => {
    expect(parseMarkers('<!-- review:senior approve sha=abc123 -->')).toEqual([])
    expect(parseMarkers(m('boss', 'approve'))).toEqual([])
    expect(parseMarkers(m('senior', 'maybe'))).toEqual([])
    expect(parseMarkers('no markers here')).toEqual([])
  })
})

describe('latestVerdict', () => {
  it('ignores markers for other SHAs (a new commit invalidates approvals)', () => {
    expect(latestVerdict([c(m('senior', 'approve', OLD))], 'senior', HEAD)).toBeUndefined()
  })
  it('uses the latest verdict by comment order, regardless of array order', () => {
    const approve = c(m('senior', 'approve'))
    const reject = c(m('senior', 'request-changes'))
    expect(latestVerdict([reject, approve], 'senior', HEAD)).toBe('request-changes')
    const later = c(m('senior', 'approve'))
    expect(latestVerdict([later, reject, approve], 'senior', HEAD)).toBe('approve')
  })
  it('within one comment the last marker wins', () => {
    expect(latestVerdict([c(`${m('senior', 'request-changes')} ${m('senior', 'approve')}`)], 'senior', HEAD)).toBe('approve')
  })
  it('does not mix kinds', () => {
    expect(latestVerdict([c(m('security', 'approve'))], 'senior', HEAD)).toBeUndefined()
  })
  it('ignores markers from untrusted commenters', () => {
    expect(latestVerdict([c(m('senior', 'approve'), 'NONE')], 'senior', HEAD)).toBeUndefined()
    expect(latestVerdict([c(m('senior', 'approve'), 'CONTRIBUTOR')], 'senior', HEAD)).toBeUndefined()
    expect(latestVerdict([c(m('senior', 'approve'), 'COLLABORATOR')], 'senior', HEAD)).toBe('approve')
    expect(latestVerdict([c(m('senior', 'approve'), 'MEMBER')], 'senior', HEAD)).toBe('approve')
  })
})

describe('decide', () => {
  it('pending with no comments', () => {
    const r = decide({ headSha: HEAD, comments: [], changedFiles: SAFE })
    expect(r.state).toBe('pending')
    expect(r.description).toContain('senior')
  })
  it('success: senior approval, safe diff', () => {
    expect(decide({ headSha: HEAD, comments: [c(m('senior', 'approve'))], changedFiles: SAFE }).state).toBe('success')
  })
  it('pending: senior approval of an older commit only', () => {
    expect(decide({ headSha: HEAD, comments: [c(m('senior', 'approve', OLD))], changedFiles: SAFE }).state).toBe('pending')
  })
  it('risky diff needs security too', () => {
    const senior = c(m('senior', 'approve'))
    const r = decide({ headSha: HEAD, comments: [senior], changedFiles: RISKY })
    expect(r.state).toBe('pending')
    expect(r.description).toContain('security')
    expect(r.description).not.toContain('senior')
    expect(decide({ headSha: HEAD, comments: [senior, c(m('security', 'approve'))], changedFiles: RISKY })).toEqual({
      state: 'success',
      description: 'senior + security approved aaaaaaa',
    })
  })
  it('security approval alone is not enough', () => {
    const r = decide({ headSha: HEAD, comments: [c(m('security', 'approve'))], changedFiles: RISKY })
    expect(r.state).toBe('pending')
    expect(r.description).toContain('senior')
  })
  it('security approval is not required on a safe diff', () => {
    expect(decide({ headSha: HEAD, comments: [c(m('senior', 'approve'))], changedFiles: SAFE }).description).toBe('senior approved aaaaaaa')
  })
  it('failure: a later request-changes cancels an approval', () => {
    const r = decide({ headSha: HEAD, comments: [c(m('senior', 'approve')), c(m('senior', 'request-changes'))], changedFiles: SAFE })
    expect(r.state).toBe('failure')
    expect(r.description).toContain('senior')
  })
  it('an approval after request-changes restores success', () => {
    const comments = [c(m('senior', 'request-changes')), c(m('senior', 'approve'))]
    expect(decide({ headSha: HEAD, comments, changedFiles: SAFE }).state).toBe('success')
  })
  it('failure names both kinds when both request changes', () => {
    const comments = [c(m('senior', 'request-changes')), c(m('security', 'request-changes'))]
    expect(decide({ headSha: HEAD, comments, changedFiles: RISKY }).description).toContain('senior and security')
  })
  it('request-changes from security on a safe diff is ignored (security not required)', () => {
    const comments = [c(m('senior', 'approve')), c(m('security', 'request-changes'))]
    expect(decide({ headSha: HEAD, comments, changedFiles: SAFE }).state).toBe('success')
  })
  it('request-changes for an old sha does not block', () => {
    const comments = [c(m('senior', 'request-changes', OLD)), c(m('senior', 'approve'))]
    expect(decide({ headSha: HEAD, comments, changedFiles: SAFE }).state).toBe('success')
  })
  it('forged approval from an untrusted user does not pass', () => {
    expect(decide({ headSha: HEAD, comments: [c(m('senior', 'approve'), 'NONE')], changedFiles: SAFE }).state).toBe('pending')
  })
  it('description never exceeds 140 characters', () => {
    expect(decide({ headSha: HEAD, comments: [], changedFiles: RISKY }).description.length).toBeLessThanOrEqual(140)
  })
})

describe('prNumberFromEvent', () => {
  it('reads pull_request events', () => expect(prNumberFromEvent({ pull_request: { number: 7 } })).toBe(7))
  it('reads comments on PRs', () => expect(prNumberFromEvent({ issue: { number: 9, pull_request: {} } })).toBe(9))
  it('ignores comments on plain issues and unknown events', () => {
    expect(prNumberFromEvent({ issue: { number: 9 } })).toBeUndefined()
    expect(prNumberFromEvent({})).toBeUndefined()
    expect(prNumberFromEvent(undefined)).toBeUndefined()
  })
})
