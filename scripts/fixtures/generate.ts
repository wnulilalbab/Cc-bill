// Regenerates every synthetic fixture under test/fixtures (except screenshots: see screens.ts).
// Run: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBackup } from './backup'
import { corruptOct, emptyStatement, handRecorded, household, isCredit, PASSWORD, printedTotals, statements, unbilledShots, type Line, type Printed, type Statement } from './data'
import { renderBca, renderMandiri } from './pdf'

export const OUT = join(import.meta.dirname, '../../test/fixtures')

const signed = (l: Line) => ({ ...l, amount: isCredit(l) ? -l.amount : l.amount })

export function expectedFor(st: Statement, lines: Line[], printed: Printed, extra: Record<string, unknown> = {}) {
  return {
    file: st.file,
    card: st.card,
    bank: st.bank,
    format: st.format,
    locked: st.locked,
    ...(st.locked ? { password: PASSWORD } : {}),
    statementDate: st.statementDate,
    dueDate: st.dueDate,
    printed,
    rows: lines.map(signed),
    ...extra,
  }
}

const json = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

export async function generate() {
  for (const d of ['statements', 'screenshots', 'unbilled', 'backup']) mkdirSync(join(OUT, d), { recursive: true })

  for (const st of statements) {
    const printed = printedTotals(st.prevBalance, st.lines)
    if (st.format === 'pdf') {
      const bytes = st.bank === 'BCA' ? await renderBca(st) : await renderMandiri(st, { lock: st.locked })
      writeFileSync(join(OUT, 'statements', `${st.file}.pdf`), bytes)
    }
    const dir = st.format === 'pdf' ? 'statements' : 'screenshots'
    json(join(OUT, dir, `${st.file}.expected.json`), expectedFor(st, st.lines, printed))
  }

  const c = corruptOct
  writeFileSync(join(OUT, 'statements', `${c.statement.file}.pdf`), await renderBca(c.statement, c.lines, c.printed))
  json(join(OUT, 'statements', `${c.statement.file}.expected.json`), expectedFor(c.statement, c.lines, c.printed, {
    reconciles: false,
    expectedDifference: c.expectedDifference,
    note: 'GRAMEDIA is printed 1 rupiah higher than the real October; printed totals are unchanged.',
  }))

  writeFileSync(join(OUT, 'statements', `${emptyStatement.file}.pdf`), await renderBca(emptyStatement))
  json(join(OUT, 'statements', `${emptyStatement.file}.expected.json`), expectedFor(emptyStatement, [], printedTotals(0, [])))

  for (const u of unbilledShots) json(join(OUT, 'unbilled', `${u.file}.expected.json`), { ...u, rows: u.lines.map(signed), lines: undefined })

  const { data, expected } = buildBackup()
  json(join(OUT, 'backup', 'old-backup.json'), data)
  json(join(OUT, 'backup', 'old-backup.expected.json'), expected)

  json(join(OUT, 'household.json'), { ...household, password: PASSWORD, handRecorded })
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  await generate()
  console.log('fixtures written to', OUT)
}
