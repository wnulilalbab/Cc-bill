// Runs Stryker on the money core (src/domain). Usage:
//   tsx scripts/mutation/run.ts                 full run (npm run test:mutation)
//   tsx scripts/mutation/run.ts --base <ref>    only domain files changed since the merge-base with <ref>
import { spawnSync } from 'node:child_process'

const DOMAIN = /^src\/domain\/.+\.ts$/
// `types.ts` files hold only type declarations: they produce no mutants and no related tests,
// and Stryker fails with "No tests were executed" when they are the only target.
const isTest = (f: string) => /\.(test|spec)\.ts$/.test(f) || /\.d\.ts$/.test(f) || /(^|\/)types\.ts$/.test(f)

/** Domain source files (not tests) among `files`, sorted. */
export function domainSources(files: string[]): string[] {
  return files.filter((f) => DOMAIN.test(f) && !isTest(f)).sort()
}

function git(args: string[]): string[] {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.split('\n').filter(Boolean)
}

function main() {
  const baseIdx = process.argv.indexOf('--base')
  const base = baseIdx > -1 ? process.argv[baseIdx + 1] : undefined
  const existing = domainSources(git(['ls-files', 'src/domain']))

  let targets: string[] | undefined // undefined = use the mutate globs from stryker.config.json
  if (existing.length === 0) {
    console.log('Nothing to mutate: src/domain has no source files yet.')
    return
  }
  if (base) {
    const changed = new Set(git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]))
    targets = existing.filter((f) => changed.has(f))
    if (targets.length === 0) {
      console.log(`Nothing to mutate: no src/domain files changed since ${base}.`)
      return
    }
    console.log(`Mutating ${targets.length} changed domain file(s):\n  ${targets.join('\n  ')}`)
  }

  const args = ['stryker', 'run', ...(targets ? ['--mutate', targets.join(',')] : [])]
  const r = spawnSync('npx', args, { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (process.argv[1]?.endsWith('scripts/mutation/run.ts')) main()
