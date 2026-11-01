// Phase 1 full scenario run (docs/intent/phase-1.md "Success criteria"; docs/test-plan.md E-01..E-04, U-02).
// Runs against `vite preview` of a STAGING build at 390px (playwright.phase1.config.ts). Synthetic fixtures only.
// The AI is mocked by route interception: each answer is built from the fixture's expected-result file, as the
// recorded responses of the unit tests are. Every other request that leaves localhost is aborted and fails the run.
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURES = join(import.meta.dirname, '..', 'test', 'fixtures')
const read = (path: string) => readFileSync(join(FIXTURES, path))
const json = <T>(path: string): T => JSON.parse(read(path).toString('utf8')) as T

interface Row {
  txDate: string
  postDate: string
  description: string
  amount: number
  kind: string
}
interface Expected {
  file: string
  format?: 'pdf' | 'screenshots'
  statementDate?: string
  dueDate?: string
  printed?: Record<string, number>
  rows: Row[]
}

const household = json<{ password: string; cards: Record<'bca' | 'mandiri', { name: string; bank: string; masked: string; owners: string[]; defaultOwner: string }> }>('household.json')
/** The old database's tables (the backup file also carries `exportedAt`). */
const oldBackup = Object.fromEntries(Object.entries(json<Record<string, unknown>>('backup/old-backup.json')).filter(([, v]) => Array.isArray(v))) as Record<string, unknown[]>
const oldExpected = json<{ counts: { transactions: number; owners: number } }>('backup/old-backup.expected.json')

/** What a correct AI answers for a fixture (same as aiAnswerFor in test/import/helpers.ts). */
function answerFor(e: Expected) {
  const screenshots = e.format === 'screenshots'
  return {
    statementDate: e.statementDate ?? null,
    dueDate: e.dueDate ?? null,
    totals: e.printed
      ? { ...e.printed, ...(screenshots ? { credits: null, purchases: null, feesInterest: null, minPayment: null } : {}) }
      : { prevBalance: null, credits: null, purchases: null, feesInterest: null, newBalance: null, minPayment: null },
    rows: e.rows.map((r) => ({ page: 0, date: r.txDate, postDate: r.postDate, description: r.description, amount: Math.abs(r.amount), credit: r.amount < 0 })),
  }
}

/** Every statement fixture with its answer; screenshots also with their image (base64) to recognise the request. */
const ANSWERS = [
  ...readdirSync(join(FIXTURES, 'statements'))
    .filter((f) => f.endsWith('.expected.json') && !f.includes('corrupt') && !f.includes('empty'))
    .map((f) => ({ e: json<Expected>(`statements/${f}`), image: null as string | null })),
  ...readdirSync(join(FIXTURES, 'screenshots'))
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => ({ e: json<Expected>(`screenshots/${f}`), image: read(`screenshots/${f.replace('.expected.json', '-p1.png')}`).toString('base64') })),
  ...readdirSync(join(FIXTURES, 'unbilled'))
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => ({ e: json<Expected>(`unbilled/${f}`), image: read(`unbilled/${f.replace('.expected.json', '.png')}`).toString('base64') })),
]

/** The fixture an AI request is about: the screenshot it carries, or the statement whose every row is in the text. */
function answerForRequest(body: { messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] }) {
  const content = body.messages[0].content
  const images = content.filter((c) => c.type === 'image').map((c) => c.source!.data)
  if (images.length) return ANSWERS.find((a) => a.image && images.includes(a.image))
  const text = content.find((c) => c.type === 'text')?.text ?? ''
  const hits = ANSWERS.filter((a) => !a.image && a.e.rows.every((r) => text.includes(r.description)))
  return hits.length === 1 ? hits[0] : undefined
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

interface Run {
  aiCalls: string[]
  leaks: string[]
}

/** What must never reach the AI (I-05): the holder's surname and either card's full or masked number. Last 4 alone is fine. */
const SECRETS = ['PRATAMA', ...Object.values(household.cards).flatMap((c) => [c.masked, c.masked.replace(/[^0-9]/g, '').slice(0, 6)])]

async function guardNetwork(page: Page): Promise<Run> {
  const run: Run = { aiCalls: [], leaks: [] }
  await page.context().route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname === 'localhost') return route.continue()
    if (url.hostname === 'api.anthropic.com') {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const raw = req.postData() ?? '{}'
      for (const secret of SECRETS) if (raw.toUpperCase().includes(secret.toUpperCase())) run.leaks.push(`AI request contains "${secret}"`)
      const body = JSON.parse(raw)
      const hit = answerForRequest(body)
      if (!hit) {
        run.leaks.push(`unrecognised AI request (${req.postData()?.length ?? 0} bytes)`)
        return route.fulfill({ status: 500, headers: cors, body: '{}' })
      }
      run.aiCalls.push(hit.e.file)
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify(answerFor(hit.e)) }], stop_reason: 'end_turn' }),
      })
    }
    run.leaks.push(req.url())
    return route.abort()
  })
  return run
}

const go = (page: Page, hash: string) => page.goto(`./#${hash}`)

/** U-02: nothing on the screen is wider than the 390px phone. */
async function expectNoSideScroll(page: Page) {
  const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, view: window.innerWidth }))
  expect(widths.doc, 'page scrolls sideways').toBeLessThanOrEqual(widths.view)
  expect(widths.body, 'page scrolls sideways').toBeLessThanOrEqual(widths.view)
}

/** Writes the synthetic old-format backup into the old app's staging database (as the old app would have). */
async function seedOldDatabase(page: Page) {
  await page.evaluate(async (data) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('CCBillDB-staging', 20) // Dexie version 2
      open.onupgradeneeded = () => {
        for (const name of [...Object.keys(data), 'settings']) open.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' })
      }
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite')
        for (const [name, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(name).put(r)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  }, oldBackup)
}

async function pick(page: Page, button: RegExp | string, listbox: string, option: RegExp | string) {
  await page.getByRole('button', { name: button }).click()
  await page.getByRole('listbox', { name: listbox }).getByRole('option', { name: option }).click()
}

async function addCard(page: Page, key: 'bca' | 'mandiri', statementDay: string, holder: string) {
  const c = household.cards[key]
  await page.getByRole('button', { name: '+ Add card' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Name', { exact: true }).fill(c.name)
  await pick(page, /^Bank: /, 'Bank', c.bank)
  await sheet.getByLabel('Last 4 digits').fill(c.masked.slice(-4))
  if (holder) await sheet.getByLabel('Name on the statement').fill(holder)
  await sheet.getByLabel('Statement day').fill(statementDay)
  for (let i = 1; i < c.owners.length; i++) await sheet.getByRole('button', { name: '+ Add owner' }).click()
  const names = sheet.getByLabel('Owner name')
  for (let i = 0; i < c.owners.length; i++) await names.nth(i).fill(c.owners[i])
  await pick(page, /^Default owner: /, 'Default owner', c.defaultOwner)
  await sheet.getByRole('button', { name: 'Save card' }).click()
  await expect(page.getByRole('status')).toHaveText('Card saved')
}

async function importStatement(page: Page, card: string, file: string, opts: { password?: string; wrongFirst?: boolean; remember?: boolean; typedTotal?: number; holder?: string; keepOpen?: boolean } = {}) {
  await go(page, '/import')
  await pick(page, /^Card: /, 'Card', new RegExp(card))
  await page.getByRole('button', { name: 'Statement', exact: true }).click()
  await page.locator('#impFile').setInputFiles(join(FIXTURES, file))
  if (opts.holder) await page.getByLabel('Card holder name, as printed on the statement').fill(opts.holder)
  await page.getByRole('button', { name: 'Read statement' }).click()
  if (opts.password) {
    // I-03: a locked PDF asks for its password; a wrong one gets a clear retry message (E-03).
    await expect(page.getByRole('alert')).toHaveText('This PDF is locked. Type its password.')
    if (opts.wrongFirst) {
      await page.getByLabel('PDF password').fill('wrong')
      await page.getByRole('button', { name: 'Unlock and read' }).click()
      await expect(page.getByRole('alert')).toHaveText("That password didn't open the file. Try again.")
    }
    await page.getByLabel('PDF password').fill(opts.password)
    if (opts.remember) await page.getByRole('checkbox', { name: /Remember for this card/ }).check()
    await page.getByRole('button', { name: 'Unlock and read' }).click()
  }
  if (opts.typedTotal !== undefined) await page.getByLabel("Bank's total on page 1 (for the totals check)").fill(opts.typedTotal.toLocaleString('id-ID'))
  // I-01: every synthetic statement matches its printed totals.
  await expect(page.getByLabel('Totals check').getByText(/^Totals match/)).toBeVisible()
  await page.getByRole('button', { name: 'Save statement' }).click()
  await expect(page.getByText('Saved ✓')).toBeVisible()
  if (!opts.keepOpen) await page.getByRole('button', { name: 'Import another' }).click()
}

/** Every bank payment of a card, oldest first: everyone selected, "Fill oldest first", nothing left over, Save. */
async function assignPayments(page: Page, card: string, payments: [string, number][]) {
  await go(page, '/payments')
  await pick(page, /^Card: /, 'Card', new RegExp(card))
  for (const [date, amount] of payments) {
    await page.getByRole('tab', { name: /^To assign/ }).click()
    await page.getByRole('link', { name: `${rp(amount)} ${day(date)}` }).click()
    await expect(page.getByRole('region', { name: 'Assign payment' })).toBeVisible()
    await page.getByRole('button', { name: 'It was for more than one person' }).click()
    const who = page.getByRole('group', { name: /^Who is this payment for/ })
    const people = await who.getByRole('button').all()
    for (const b of people) if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
    await page.getByRole('button', { name: 'Fill oldest first' }).click()
    await expect(page.getByLabel('Left to assign')).toHaveText('0')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL(/#\/payments$/)
  }
  await expect(page.getByRole('tab', { name: /^To assign/ })).toHaveText('To assign')
}

test('Phase 1: migrate, import, tag, assign, bill equals the bank, share, delete old data (390px, staging, mocked AI)', async ({ page }) => {
  const run = await guardNetwork(page)
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
  })

  await go(page, '/')
  await expect(page.getByText(/Staging — test data/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bill', level: 1 })).toBeVisible()

  // Settings: the AI key (synthetic; the API is mocked).
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.locator('#aiKey').fill('sk-ant-e2e-synthetic-0000')
  await page.getByRole('button', { name: 'Save key' }).click()

  // E-04 / G-01 / G-02 / G-03: migrate the synthetic old backup (preview → confirm → verify).
  await seedOldDatabase(page)
  await page.reload()
  await expect(page.getByText(`Old data found: ${oldExpected.counts.transactions} transactions, ${oldExpected.counts.owners} owners.`)).toBeVisible()
  await page.getByRole('button', { name: 'Migrate old data' }).click()
  const preview = page.getByRole('dialog', { name: 'Migration preview' })
  await expect(preview.getByRole('list', { name: 'Adjustments' }).getByRole('listitem').first()).toBeVisible()
  await pick(page, 'Default owner: None', 'Default owner', 'Keluarga')
  await expect(preview.getByRole('list', { name: 'Adjustments' })).toContainText('card default (Keluarga)')
  await preview.getByRole('button', { name: 'Confirm and migrate' }).click()
  const done = page.getByRole('dialog', { name: 'Migration done' })
  await expect(done.getByText('Everything matches ✓')).toBeVisible()
  await expect(done.getByText('Same to the rupiah')).toHaveCount(4)
  await done.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Old data migrated ✓ and kept as a backup.')).toBeVisible()
  await expectNoSideScroll(page)

  // C-01: the two fictional cards, each with its own owners and default owner.
  await addCard(page, 'bca', '12', '') // holder name asked on the first PDF import instead
  await addCard(page, 'mandiri', '11', 'ANDI PRATAMA')

  // I-01 / I-03 / I-04 / I-13: BCA Jul–Nov PDFs, Mandiri Aug–Sep screenshots (typed totals) and Oct–Nov locked PDFs.
  for (const m of ['07', '08', '09', '10', '11']) await importStatement(page, 'BCA Keluarga', `statements/bca-2026-${m}.pdf`, m === '07' ? { holder: 'ANDI PRATAMA' } : {})
  for (const m of ['08', '09']) {
    const e = json<Expected>(`screenshots/mandiri-2026-${m}.expected.json`)
    await importStatement(page, 'Mandiri Pribadi', `screenshots/mandiri-2026-${m}-p1.png`, { typedTotal: e.printed!.newBalance })
  }
  await importStatement(page, 'Mandiri Pribadi', 'statements/mandiri-2026-10.pdf', { password: household.password, wrongFirst: true, remember: true })
  // I-04: remembered, so the next locked PDF opens without asking.
  await importStatement(page, 'Mandiri Pribadi', 'statements/mandiri-2026-11.pdf')
  expect(run.aiCalls.sort()).toEqual(['bca-2026-07', 'bca-2026-08', 'bca-2026-09', 'bca-2026-10', 'bca-2026-11', 'mandiri-2026-08', 'mandiri-2026-09', 'mandiri-2026-10', 'mandiri-2026-11'])
  await expectNoSideScroll(page)

  // E-01 / T-07: review a Check row in the list (a marketplace row: tagged by hand, no rule offered).
  await go(page, '/transactions')
  await pick(page, /^Card: /, 'Card', /BCA Keluarga/)
  await expect(page.getByRole('button', { name: 'Statement: Nov 2026 statement' })).toBeVisible()
  const draft = page.getByLabel('Draft or Final')
  await expect(draft.getByRole('button', { name: '1 row needs a check' })).toBeVisible()
  await page.getByRole('button', { name: 'TOKOPEDIA JAKARTA 320.000' }).click()
  const sheet = page.getByRole('dialog', { name: 'TOKOPEDIA JAKARTA' })
  await sheet.getByRole('group', { name: 'Who pays' }).getByRole('button', { name: 'Sari' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(draft.getByRole('button', { name: /needs? a check/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'TOKOPEDIA JAKARTA 320.000' })).toContainText('Sari')
  await expectNoSideScroll(page)

  // Assign every payment the banks printed, oldest first (U-07: the full-screen page; P-06 Fill oldest first).
  await assignPayments(page, 'BCA Keluarga', [
    ['2026-07-26', 1_000_000],
    ['2026-08-27', 3_122_682],
    ['2026-09-26', 200_000],
    ['2026-09-27', 1_470_000],
    ['2026-10-20', 2_000_000],
    ['2026-10-30', 1_500_000],
  ])
  await expectNoSideScroll(page)
  await assignPayments(page, 'Mandiri Pribadi', [
    ['2026-08-31', 603_800],
    ['2026-09-30', 377_933],
    ['2026-10-31', 647_034],
  ])

  // M-09 / M-10: with every payment assigned, each card's bill equals the bank's printed new balance.
  await go(page, '/bill')
  const tile = (name: string, total: number) => page.getByRole('button', { name: `${name} ${rp(total)}` })
  await tile('BCA Keluarga', 1_625_380).click()
  await expect(tile('BCA Keluarga', 1_625_380)).toHaveAttribute('aria-pressed', 'true')
  const hero = page.getByLabel('To pay')
  await expect(hero.locator('.sub')).toHaveText('To pay for the Nov 2026 bill')
  await expect(hero.locator('.big')).toHaveText(rp(1_625_380))
  await expectNoSideScroll(page)
  await tile('Mandiri Pribadi', 348_133).click()
  await expect(tile('Mandiri Pribadi', 348_133)).toHaveAttribute('aria-pressed', 'true')
  await expect(hero.locator('.big')).toHaveText(rp(348_133))

  // S-06 / E-01: share everyone's BCA bill as text; the clipboard holds exactly the previewed message.
  await tile('BCA Keluarga', 1_625_380).click()
  await expect(hero.locator('.big')).toHaveText(rp(1_625_380))
  await page.getByRole('button', { name: "Share everyone's bill" }).click()
  const message = await page.getByLabel('Message preview').textContent()
  expect(message).toContain('BCA Keluarga')
  await page.getByRole('button', { name: 'Copy as text' }).click()
  await expect(page.getByRole('status')).toHaveText('Copied. Paste it in WhatsApp.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message)
  await page.keyboard.press('Escape')

  // Insights (preview) and the other tabs fit the phone too.
  await go(page, '/insights')
  await expect(page.getByText('Phase 2 preview')).toBeVisible()
  await expectNoSideScroll(page)

  // E-04 / G-04: Delete old data, two steps: the JSON backup first, then the delete.
  await go(page, '/settings')
  await page.getByRole('button', { name: 'Delete old data (downloads a backup first)' }).click()
  const del = page.getByRole('dialog', { name: 'Delete old data?' })
  await expect(del.getByRole('button', { name: /delete old data$/ })).toBeDisabled()
  const [download] = await Promise.all([page.waitForEvent('download'), del.getByRole('button', { name: 'Download backup' }).click()])
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8')) as Record<string, unknown[]>
  expect(backup.transactions).toHaveLength((oldBackup.transactions as unknown[]).length)
  await del.getByRole('button', { name: "I've saved the backup file — delete old data" }).click()
  await expect(page.getByText('Old data deleted. Everything is in the new database.')).toBeVisible()
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  expect(names).not.toContain('CCBillDB-staging')
  expect(names).toContain('ccbill-v2-staging')

  // The migrated card is still there; production's databases were never touched.
  expect(names).not.toContain('ccbill-v2')
  expect(names).not.toContain('CCBillDB')
  expect(run.leaks).toEqual([])
  expect(problems).toEqual([])
})

test('E-02 Unbilled screenshots with a payment line → assign → the next statement moves both, assignment kept (390px, staging, mocked AI)', async ({ page }) => {
  const run = await guardNetwork(page)
  await go(page, '/settings')
  await page.locator('#aiKey').fill('sk-ant-e2e-synthetic-0000')
  await page.getByRole('button', { name: 'Save key' }).click()
  await addCard(page, 'bca', '12', 'ANDI PRATAMA')
  for (const m of ['07', '08', '09']) await importStatement(page, 'BCA Keluarga', `statements/bca-2026-${m}.pdf`)

  // Unbilled screenshots of 10 Oct: Watsons 25 Sep, its payment line 26 Sep, and a pending GRAB that never bills.
  await go(page, '/import')
  await pick(page, /^Card: /, 'Card', /BCA Keluarga/)
  await page.getByRole('button', { name: 'Unbilled screenshots' }).click()
  await page.locator('#impFile').setInputFiles(join(FIXTURES, 'unbilled/bca-unbilled-2026-10-10.png'))
  await page.getByRole('button', { name: 'Read screenshots' }).click()
  await page.getByRole('button', { name: 'Save to Unbilled' }).click()
  await expect(page.getByText('Saved ✓')).toBeVisible()
  await page.getByRole('button', { name: 'Import another' }).click()

  // The payment line waits under To assign; it paid Watsons.
  await go(page, '/payments')
  await page.getByRole('link', { name: `${rp(200_000)} ${day('2026-09-26')}` }).click()
  await expect(page.getByRole('region', { name: 'Assign payment' })).toBeVisible()
  await page.getByRole('group', { name: /^Who is this payment for/ }).getByRole('button', { name: 'Keluarga' }).click()
  // P-01: Unbilled is the last group, folded; open it.
  await page.getByRole('region', { name: 'Unbilled' }).getByRole('button', { name: /^Unbilled 1 open/ }).click()
  await page.getByRole('button', { name: 'WATSONS SENAYAN CITY' }).click()
  await expect(page.getByLabel('Left to assign')).toHaveText('0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/#\/payments$/)

  // The Oct statement arrives: the Unbilled charges and the payment line move into it (I-08); the pending GRAB is
  // flagged and kept waiting (I-10).
  await importStatement(page, 'BCA Keluarga', 'statements/bca-2026-10.pdf', { keepOpen: true })
  await expect(page.getByText(/^\d+ charges and 1 payment lines were already in Unbilled/)).toBeVisible()
  await expect(page.getByText(/GRAB\* .* 27\.000 was in Unbilled but isn't on this statement/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep waiting' }).click()
  await expect(page.getByText('OK. It stays in Unbilled for the next statement.')).toBeVisible()

  await go(page, '/transactions')
  await expect(page.getByRole('button', { name: 'Statement: Oct 2026 statement' })).toBeVisible()
  const watsons = page.getByRole('button', { name: 'WATSONS SENAYAN CITY 200.000' })
  await expect(watsons).toContainText('Keluarga')
  await expect(watsons).toContainText('Paid')
  await go(page, '/payments')
  await page.getByRole('tab', { name: /^Assigned/ }).click()
  await expect(page.getByRole('link', { name: `${rp(200_000)} ${day('2026-09-26')}` })).toBeVisible()
  await expectNoSideScroll(page)
  expect(run.aiCalls.sort()).toEqual(['bca-2026-07', 'bca-2026-08', 'bca-2026-09', 'bca-2026-10', 'bca-unbilled-2026-10-10'])
  expect(run.leaks).toEqual([])
})
