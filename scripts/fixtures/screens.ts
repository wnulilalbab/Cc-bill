// Renders the "bank app" screenshots (PNG) with Playwright. Run: npm run fixtures:screens
// Kept separate from generate.ts because it needs a browser; the PNGs are committed.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { isCredit, printedTotals, statements, unbilledShots, type Line } from './data'
import { idrMandiri, mandiriDate } from './pdf'

const OUT = join(import.meta.dirname, '../../test/fixtures')
const ROWS_PER_SHOT = 6
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const appDate = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const bcaAmount = (l: Line) => (isCredit(l) ? '+' : '-') + 'Rp ' + l.amount.toLocaleString('id-ID')
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

const shell = (title: string, sub: string, body: string, accent: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:390px;font-family:Arial,Helvetica,sans-serif;background:#f4f5f7;color:#1b1f24}
.h{background:${accent};color:#fff;padding:18px 16px}.h b{font-size:17px}.h div{font-size:12px;opacity:.85;margin-top:4px}
.r{background:#fff;margin:8px 10px;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;gap:10px;font-size:13px}
.r .d{color:#6b7280;font-size:11px;margin-top:3px}.a{font-weight:bold;white-space:nowrap}.cr{color:#15803d}
.t{margin:8px 10px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;font-weight:bold}
</style></head><body><div class="h"><b>${esc(title)}</b><div>${esc(sub)}</div></div>${body}</body></html>`

async function main() {
  mkdirSync(join(OUT, 'screenshots'), { recursive: true })
  mkdirSync(join(OUT, 'unbilled'), { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1 })
  const shoot = async (html: string, file: string) => {
    await page.setContent(html)
    await page.screenshot({ path: file, fullPage: true })
  }

  for (const u of unbilledShots) {
    const rows = u.lines.map((l) => `<div class="r"><div>${esc(l.description)}<div class="d">${appDate(l.txDate)}</div></div><div class="a ${isCredit(l) ? 'cr' : ''}">${bcaAmount(l)}</div></div>`).join('')
    await shoot(shell('Transaksi Belum Ditagih', `Kartu Kredit •••• 1234 · per ${appDate(u.capturedAt)}`, rows, '#0b5cab'), join(OUT, 'unbilled', `${u.file}.png`))
  }

  for (const st of statements.filter((s) => s.format === 'screenshots')) {
    const printed = printedTotals(st.prevBalance, st.lines)
    const chunks: Line[][] = []
    for (let i = 0; i < st.lines.length; i += ROWS_PER_SHOT) chunks.push(st.lines.slice(i, i + ROWS_PER_SHOT))
    for (let i = 0; i < chunks.length; i++) {
      const head = i === 0 ? `<div class="t"><span>Tagihan Bulan Lalu</span><span>${idrMandiri(printed.prevBalance)}</span></div>` : ''
      const rows = chunks[i].map((l) => `<div class="r"><div>${esc(l.description)}<div class="d">${mandiriDate(l.txDate)} · ${mandiriDate(l.postDate)}</div></div><div class="a ${isCredit(l) ? 'cr' : ''}">${idrMandiri(l.amount)}${isCredit(l) ? ' CR' : ''}</div></div>`).join('')
      const foot = i === chunks.length - 1 ? `<div class="t"><span>Total Tagihan</span><span>${idrMandiri(printed.newBalance)}</span></div>` : ''
      await shoot(shell('Tagihan Kartu Kredit', `Statement ${mandiriDate(st.statementDate)} · Jatuh tempo ${mandiriDate(st.dueDate)} · hal ${i + 1}/${chunks.length}`, head + rows + foot, '#003d79'),
        join(OUT, 'screenshots', `${st.file}-p${i + 1}.png`))
    }
  }
  await browser.close()
  console.log('screenshots written')
}

await main()
