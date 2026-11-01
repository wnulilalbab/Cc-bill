import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { buildBackup } from '../scripts/fixtures/backup'
import { corruptOct, emptyStatement, isCredit, PASSWORD, printedTotals, statements, unbilledShots } from '../scripts/fixtures/data'
import { expectedFor, OUT } from '../scripts/fixtures/generate'
import { idr, idrMandiri, renderBca } from '../scripts/fixtures/pdf'

const read = (p: string) => JSON.parse(readFileSync(join(OUT, p), 'utf8'))
const bytes = (p: string) => new Uint8Array(readFileSync(join(OUT, p)))

async function pdfText(data: Uint8Array, password?: string) {
  const doc = await pdfjs.getDocument({ data: data.slice(), password, verbosity: 0 }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    text += tc.items.map((it: any) => it.str).join('\n') + '\n'
  }
  return { text, pages: doc.numPages }
}

const fmt = (bank: string, n: number) => (bank === 'BCA' ? idr(n) : idrMandiri(n))
const allStatements = [...statements, corruptOct.statement, emptyStatement]
const fileOf = (s: { file: string; format: string }) => `${s.format === 'pdf' ? 'statements' : 'screenshots'}/${s.file}`

describe('fixture data', () => {
  it('chains each card: a statement opens with the previous one\'s new balance', () => {
    for (const card of ['bca', 'mandiri']) {
      const list = statements.filter((s) => s.card === card)
      list.slice(1).forEach((s, i) => expect(s.prevBalance).toBe(printedTotals(list[i].prevBalance, list[i].lines).newBalance))
    }
  })

  it('reconciles every statement: previous − credits + purchases + fees/interest = new balance', () => {
    for (const s of statements) {
      const e = read(`${fileOf(s)}.expected.json`)
      const sum = (pred: (r: any) => boolean) => e.rows.filter(pred).reduce((t: number, r: any) => t + Math.abs(r.amount), 0)
      const credits = sum((r) => ['payment', 'refund', 'reversal'].includes(r.kind))
      const purchases = sum((r) => r.kind === 'purchase' || r.kind === 'installment')
      const fees = sum((r) => r.kind === 'fee' || r.kind === 'interest')
      expect({ credits, purchases, fees }).toEqual({ credits: e.printed.credits, purchases: e.printed.purchases, fees: e.printed.feesInterest })
      expect(e.printed.prevBalance - credits + purchases + fees).toBe(e.printed.newBalance)
    }
  })

  it('makes the corrupt October copy disagree with its printed totals by exactly 1 rupiah', () => {
    const e = read('statements/bca-2026-10-corrupt.expected.json')
    const charged = e.rows.filter((r: any) => r.amount > 0).reduce((t: number, r: any) => t + r.amount, 0)
    expect(charged - (e.printed.purchases + e.printed.feesInterest)).toBe(1)
    expect(e.reconciles).toBe(false)
  })

  it('stores credits as negative amounts and charges as positive', () => {
    for (const s of statements) {
      const e = read(`${fileOf(s)}.expected.json`)
      e.rows.forEach((r: any, i: number) => expect(Math.sign(r.amount)).toBe(isCredit(s.lines[i]) ? -1 : 1))
    }
  })

  it('keeps committed expected files in sync with the generator', () => {
    for (const s of statements) expect(read(`${fileOf(s)}.expected.json`)).toEqual(JSON.parse(JSON.stringify(expectedFor(s, s.lines, printedTotals(s.prevBalance, s.lines)))))
    expect(read(`statements/${emptyStatement.file}.expected.json`).rows).toEqual([])
  })

  it('covers the agreed scenarios', () => {
    const all = statements.flatMap((s) => s.lines)
    expect(all.some((l) => l.kind === 'reversal' && l.reverses)).toBe(true)
    expect(all.some((l) => l.kind === 'refund')).toBe(true)
    expect(all.some((l) => l.installment?.n === 1 && l.installment.of === 6)).toBe(true)
    const oct = statements.find((s) => s.file === 'bca-2026-10')!
    const shopee = oct.lines.filter((l) => l.description.startsWith('SHOPEE') && l.amount === 150000)
    expect(shopee).toHaveLength(2)
    expect(unbilledShots.some((u) => u.lines.some((l) => l.kind === 'payment'))).toBe(true)
    expect(statements.filter((s) => s.format === 'screenshots').map((s) => s.file)).toEqual(['mandiri-2026-08', 'mandiri-2026-09'])
  })
})

describe('statement PDFs', () => {
  for (const s of allStatements.filter((x) => x.format === 'pdf')) {
    it(`${s.file}: every row, date and total is readable as text`, async () => {
      const e = read(`statements/${s.file}.expected.json`)
      const { text } = await pdfText(bytes(`statements/${s.file}.pdf`), s.locked ? PASSWORD : undefined)
      for (const r of e.rows) {
        expect(text).toContain(r.description)
        expect(text).toContain(fmt(s.bank, Math.abs(r.amount)) + (r.amount < 0 ? ' CR' : ''))
      }
      expect(text).toContain(fmt(s.bank, e.printed.newBalance))
    })
  }

  it('locks the Mandiri PDFs: no password and wrong password fail, test1234 opens', async () => {
    for (const s of statements.filter((x) => x.locked)) {
      const data = bytes(`statements/${s.file}.pdf`)
      await expect(pdfText(data)).rejects.toMatchObject({ name: 'PasswordException' })
      await expect(pdfText(data, 'wrong-password')).rejects.toMatchObject({ name: 'PasswordException' })
      await expect(pdfText(data, PASSWORD)).resolves.toBeTruthy()
    }
  })

  it('splits long statements across pages (table breaks mid-statement)', async () => {
    expect((await pdfText(bytes('statements/bca-2026-10.pdf'))).pages).toBeGreaterThan(1)
  })

  it('regenerates unlocked PDFs byte-for-byte', async () => {
    for (const s of statements.filter((x) => x.bank === 'BCA')) {
      expect(Buffer.compare(Buffer.from(await renderBca(s)), Buffer.from(bytes(`statements/${s.file}.pdf`)))).toBe(0)
    }
  })
})

describe('screenshots', () => {
  const png = (p: string) => {
    const b = readFileSync(join(OUT, p))
    expect(b.subarray(1, 4).toString()).toBe('PNG')
    return b.readUInt32BE(16) // width
  }
  it('has one PNG per unbilled capture and per statement-screenshot page, 390px wide', () => {
    for (const u of unbilledShots) expect(png(`unbilled/${u.file}.png`)).toBe(390)
    for (const s of statements.filter((x) => x.format === 'screenshots')) {
      const pages = readdirSync(join(OUT, 'screenshots')).filter((f) => f.startsWith(s.file) && f.endsWith('.png'))
      expect(pages.length).toBeGreaterThan(0)
      pages.forEach((p) => expect(png(`screenshots/${p}`)).toBe(390))
    }
    expect(existsSync(join(OUT, 'unbilled', 'bca-unbilled-2026-10-20-overlap.png'))).toBe(true)
  })
})

describe('old-format backup', () => {
  const { data, expected } = buildBackup()

  it('matches the committed backup and expected-result files', () => {
    expect(read('backup/old-backup.json')).toEqual(JSON.parse(JSON.stringify(data)))
    expect(read('backup/old-backup.expected.json')).toEqual(expected)
  })

  it('has the shape and edge cases the migration must handle', () => {
    expect(expected.counts.transactions).toBeGreaterThanOrEqual(280)
    expect(expected.unknownOwnerExpenses).toBeGreaterThan(0)
    expect(expected.unlabeledTransactions).toBeGreaterThan(0)
    expect(data.expenses.some((e: any) => e.status === 'partial')).toBe(true)
  })

  it('never allocates more to a charge than it costs, and every allocation points at real rows', () => {
    const tx = new Map(data.transactions.map((t: any) => [t.id, t]))
    const ex = new Map(data.expenses.map((e: any) => [e.id, e]))
    const per = new Map<string, number>()
    for (const a of data.paymentAllocations as any[]) {
      expect(tx.get(a.paymentId)?.type).toBe('payment')
      expect(ex.has(a.expenseId)).toBe(true)
      per.set(a.expenseId, (per.get(a.expenseId) ?? 0) + a.amount)
    }
    for (const [id, amt] of per) expect(amt).toBeLessThanOrEqual((tx.get((ex.get(id) as any).transactionId) as any).amount)
  })
})
