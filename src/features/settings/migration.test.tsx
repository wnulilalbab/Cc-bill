// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate, MIGRATED_CARD, planMigration, type Verification } from '../../data/migration'
import { readOldData } from '../../data/old'
import { readAll } from '../../data/repo'
import { renderScreen } from '../../test-utils/ui'
import { dumpIdb, fixture, freshNewDb, seedOldDb, uniqueName } from '../../../test/data/oldDb'
import expected from '../../../test/fixtures/backup/old-backup.expected.json'
import { Shell } from '../Shell'
import { DeleteOldSheet } from './DeleteOldSheet'
import { VerificationView } from './MigrateSheet'
import { SettingsPage } from './SettingsPage'

beforeEach(() => {
  vi.stubGlobal('__APP_ENV__', 'production')
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const keluargaId = () => fixture().owners.find((o) => o.name === 'Keluarga')!.id

async function openPreview() {
  const oldName = await seedOldDb(fixture())
  const db = freshNewDb()
  const r = renderScreen(<SettingsPage />, { db, oldName })
  await screen.findByText(`Old data found: ${expected.counts.transactions} transactions, ${expected.counts.owners} owners.`)
  await r.user.click(screen.getByRole('button', { name: 'Migrate old data' }))
  await screen.findByRole('dialog', { name: 'Migration preview' })
  return r
}

describe('Settings → Data → Migrate old data', () => {
  it('G-02 the preview lists every adjustment from planMigration; Cancel writes nothing', async () => {
    const { user, db, oldName } = await openPreview()
    const before = await dumpIdb(oldName)
    const plan = planMigration((await readOldData(oldName))!)
    const items = within(screen.getByRole('list', { name: 'Adjustments' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(plan.adjustments.map((a) => a.message))
    expect(screen.getByText(`Needs your OK · ${plan.adjustments.length}`)).toBeTruthy()
    const counts = within(screen.getByRole('dialog')).getByText('Transactions').parentElement!
    expect(counts.textContent).toBe(`Transactions${plan.data.transactions.length}`)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [], rules: [] })
    expect(await db.meta.count()).toBe(0)
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-03 the default owner picked in the preview gets the "Unknown" rows, marked Check; G-01 verification passes', async () => {
    const { user, db, oldName } = await openPreview()
    const before = await dumpIdb(oldName)
    const noneText = screen.getAllByRole('listitem').map((li) => li.textContent).join('\n')
    expect(noneText).toContain('card default (None)')

    await user.click(screen.getByRole('button', { name: 'Default owner: None' }))
    const picker = screen.getByRole('listbox', { name: 'Default owner' })
    expect(within(picker).queryByRole('option', { name: /^Unknown/ })).toBeNull()
    await user.click(within(picker).getByRole('option', { name: 'Keluarga' }))
    const text = screen.getAllByRole('listitem').map((li) => li.textContent).join('\n')
    expect(text).toContain('card default (Keluarga)')

    await user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    await screen.findByRole('dialog', { name: 'Migration done' })
    expect(screen.getByText('Everything matches ✓')).toBeTruthy()
    expect(screen.getByText('Transactions old / new').parentElement!.textContent).toMatch(/(\d+) \/ \1$/)
    expect(screen.getAllByText('Same to the rupiah')).toHaveLength(4)

    const card = (await db.cards.get(MIGRATED_CARD.id))!
    expect(card.defaultOwnerId).toBe(keluargaId())
    const old = (await readOldData(oldName))!
    const unknownOwner = old.owners.find((o) => o.name.toLowerCase() === 'unknown')!
    const unknownTxIds = new Set(old.expenses.filter((e) => e.ownerId === unknownOwner.id).map((e) => e.transactionId))
    const rows = (await db.transactions.toArray()).filter((t) => unknownTxIds.has(t.id))
    expect(rows.length).toBe(expected.unknownOwnerExpenses)
    for (const t of rows) {
      expect(t.ownerId).toBe(keluargaId())
      expect(t.check).toBe(true)
    }
    expect(await dumpIdb(oldName)).toEqual(before)

    await user.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByText('Old data migrated ✓ and kept as a backup.')
    expect(screen.getByText('BCA Shared')).toBeTruthy()
  })

  it('puts the default-owner picker above the counts, and cannot be closed while migrating', async () => {
    const { user, db } = await openPreview()
    const dialog = screen.getByRole('dialog', { name: 'Migration preview' })
    const picker = within(dialog).getByRole('button', { name: 'Default owner: None' })
    const counts = within(dialog).getByText('Transactions')
    expect(picker.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    let release = () => {}
    const real = db.transaction.bind(db) as (...a: unknown[]) => Promise<unknown>
    vi.spyOn(db, 'transaction').mockImplementationOnce(((...args: unknown[]) => new Promise((resolve) => (release = () => resolve(real(...args))))) as never)
    await user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    expect(screen.getByRole('button', { name: 'Migrating…' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('sheet-overlay'))
    expect(screen.getByRole('dialog', { name: 'Migration preview' })).toBeTruthy()
    release()
    await screen.findByText('Everything matches ✓')
  })

  it('offers the statement day in the preview and rejects an impossible one', async () => {
    const { user, db } = await openPreview()
    await user.type(screen.getByLabelText('Statement day (optional)'), '40')
    expect(screen.getByRole('alert').textContent).toMatch(/statement day must be 1–31/)
    expect((screen.getByRole('button', { name: 'Confirm and migrate' }) as HTMLButtonElement).disabled).toBe(true)
    await user.clear(screen.getByLabelText('Statement day (optional)'))
    await user.type(screen.getByLabelText('Statement day (optional)'), '12')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    await screen.findByText('Everything matches ✓')
    expect((await db.cards.get(MIGRATED_CARD.id))!.statementDay).toBe(12)
  })

  it('shows a failed verification with every difference, and says the old data is unchanged', () => {
    const counts = { owners: 6, statements: 11, transactions: 2, bankPayments: 0, manualPayments: 0, plans: 0, allocations: 0 }
    const v: Verification = {
      ok: false,
      differences: [{ check: 'count of transactions', expected: 2, actual: 1 }],
      expected: { counts, totals: { charges: 1000, credits: 0, manualPayments: 0, allocated: 0 } },
      actual: { counts: { ...counts, transactions: 1 }, totals: { charges: 500, credits: 0, manualPayments: 0, allocated: 0 } },
    }
    const onClose = vi.fn()
    render(
      <Shell db={freshNewDb()} oldName={uniqueName('none')}>
        <VerificationView v={v} onClose={onClose} />
      </Shell>,
    )
    expect(screen.getByText('Verification found 1 difference')).toBeTruthy()
    expect(screen.getByText('count of transactions: expected 2, got 1')).toBeTruthy()
    expect(screen.getByText('Total charged').parentElement!.textContent).toContain('Rp 1.000 / Rp 500')
    expect(screen.getByText(/old data is unchanged/)).toBeTruthy()
    screen.getByRole('button', { name: 'Done' }).click()
    expect(onClose).toHaveBeenCalled()
  })

  it('reports when there is no old data, and when the old data cannot be read', async () => {
    renderScreen(<SettingsPage />)
    expect(await screen.findByText('No old data on this phone.')).toBeTruthy()
    cleanup()

    const bad = fixture()
    ;(bad.transactions[0] as unknown as { amount: number }).amount = 1.5
    const oldName = await seedOldDb(bad)
    renderScreen(<SettingsPage />, { oldName })
    expect((await screen.findByRole('alert')).textContent).toMatch(/The old data could not be read/)
  })

  it('asks to migrate again when the old data changed after verification', async () => {
    const { user, oldName } = await openPreview()
    await user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    await screen.findByText('Everything matches ✓')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByText('Old data migrated ✓ and kept as a backup.')
    cleanup()

    const old = new Dexie(oldName)
    await old.open()
    await old.table('owners').put({ id: 'o-new', name: 'Added later' })
    old.close()
    renderScreen(<SettingsPage />, { oldName, db: freshNewDb() }) // a fresh new DB: no verification
    await screen.findByText(/Old data found/)
  })
})

describe('Settings → Data → Delete old data', () => {
  async function migrated() {
    const r = await openPreview()
    await r.user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    await screen.findByText('Everything matches ✓')
    await r.user.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByText('Old data migrated ✓ and kept as a backup.')
    return r
  }

  function captureDownloads(oldName: string) {
    const downloads: { existed: boolean; blob: Blob }[] = []
    const pending: Promise<void>[] = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      pending.push(Dexie.exists(oldName).then((existed) => void downloads.push({ existed, blob: blob as Blob })))
      return 'blob:synthetic'
    })
    URL.revokeObjectURL = vi.fn()
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return { downloads, clicks, settled: () => Promise.all(pending) }
  }

  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(blob)
    })

  const step2 = () => screen.getByRole('button', { name: "I've saved the backup file — delete old data" }) as HTMLButtonElement

  it('G-04 step 1 downloads the backup, step 2 is a separate deliberate tap that deletes the old database', async () => {
    const { user, oldName, db } = await migrated()
    const data = await readAll(db)
    const { downloads, clicks, settled } = captureDownloads(oldName)

    await user.click(screen.getByRole('button', { name: 'Delete old data (downloads a backup first)' }))
    expect(screen.getByRole('dialog', { name: 'Delete old data?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Download backup' })) // focus starts on the safe step
    expect(step2().disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await screen.findByText(/Backup ready: ccbill-old-backup-/)
    await settled()
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(await Dexie.exists(oldName)).toBe(true) // step 1 alone deletes nothing
    expect(downloads[0].existed).toBe(true)
    const backup = JSON.parse(await readBlob(downloads[0].blob))
    expect(backup.transactions).toHaveLength(expected.counts.transactions)
    expect(screen.getByRole('button', { name: 'Download backup again' })).toBeTruthy()

    expect(step2().disabled).toBe(false)
    await user.click(step2())
    await screen.findByText('Old data deleted. Keep the backup file safe.')
    expect(await Dexie.exists(oldName)).toBe(false)
    expect(await readAll(db)).toEqual(data) // the migrated data is not touched
    await screen.findByText('Old data deleted. Everything is in the new database.')
  })

  it('G-04 the old database survives when step 2 is not confirmed (Cancel, Escape, overlay)', async () => {
    const { user, oldName } = await migrated()
    captureDownloads(oldName)
    const open = () => user.click(screen.getByRole('button', { name: 'Delete old data (downloads a backup first)' }))

    await open()
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await screen.findByText(/Backup ready/)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await Dexie.exists(oldName)).toBe(true)

    // Re-opening starts over: step 2 is disabled again until the backup is saved in this sheet.
    await open()
    expect(step2().disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await screen.findByText(/Backup ready/)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await open()
    await user.click(screen.getByTestId('sheet-overlay'))
    expect(await Dexie.exists(oldName)).toBe(true)
    expect(screen.getByText('Old data migrated ✓ and kept as a backup.')).toBeTruthy()
  })

  it('G-04 a failed or cancelled save keeps step 2 disabled; a changed old DB blocks the delete', async () => {
    const oldName = await seedOldDb(fixture())
    const db = freshNewDb()
    const onDeleted = vi.fn()
    let fail = true
    const save = vi.fn(async () => {
      if (fail) throw new Error('The share was cancelled.')
    })
    const user = userEvent.setup()
    const r = render(
      <Shell db={db} oldName={oldName}>
        <DeleteOldSheet onClose={() => {}} onDeleted={onDeleted} save={save} now={() => '2026-11-01T00:00:00.000Z'} />
      </Shell>,
    )
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The backup was not saved. Old data can only be deleted after a migration has passed verification.')
    expect(save).not.toHaveBeenCalled()

    const old = (await readOldData(oldName))!
    await migrate(db, old, planMigration(old))
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The backup was not saved. The share was cancelled.'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'ccbill-old-backup-2026-11-01.json' }), 'download')
    expect(step2().disabled).toBe(true)

    fail = false
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await screen.findByText('Backup ready: ccbill-old-backup-2026-11-01.json. Check it is in your files before you go on.')
    // The old data changes after the file was saved: the saved file no longer matches, so nothing is deleted.
    const raw = new Dexie(oldName)
    await raw.open()
    await raw.table('owners').put({ id: 'o-late', name: 'Added later' })
    raw.close()
    await user.click(step2())
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Nothing was deleted. The old data changed after it was verified/)
    expect(await Dexie.exists(oldName)).toBe(true)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(step2().disabled).toBe(true)
    r.unmount()

    // No old database at all.
    const db2 = freshNewDb()
    const other = await seedOldDb(fixture())
    const o2 = (await readOldData(other))!
    await migrate(db2, o2, planMigration(o2))
    await Dexie.delete(other)
    render(
      <Shell db={db2} oldName={other}>
        <DeleteOldSheet onClose={() => {}} onDeleted={onDeleted} save={save} />
      </Shell>,
    )
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The backup was not saved. There is no old data to delete.')
  })

  it('G-04 the delete rebuilds the backup with the saved timestamp, so a moving clock still matches', async () => {
    const oldName = await seedOldDb(fixture())
    const db = freshNewDb()
    const old = (await readOldData(oldName))!
    await migrate(db, old, planMigration(old))
    let t = 0
    const user = userEvent.setup()
    render(
      <Shell db={db} oldName={oldName}>
        {/* A clock that moves: the backup is rebuilt with the saved timestamp, so it still matches. */}
        <DeleteOldSheet onClose={() => {}} onDeleted={() => {}} save={async () => {}} now={() => `2026-11-0${++t}T00:00:00.000Z`} />
      </Shell>,
    )
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await screen.findByText(/Backup ready: ccbill-old-backup-2026-11-01.json/)
    await user.click(step2())
    await waitFor(async () => expect(await Dexie.exists(oldName)).toBe(false))
  })

  it('offers the share sheet as a save path when the browser can share files', async () => {
    const share = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, share, canShare: () => true })
    const oldName = await seedOldDb(fixture())
    const db = freshNewDb()
    const old = (await readOldData(oldName))!
    await migrate(db, old, planMigration(old))
    const user = userEvent.setup()
    render(
      <Shell db={db} oldName={oldName}>
        <DeleteOldSheet onClose={() => {}} onDeleted={() => {}} />
      </Shell>,
    )
    await user.click(screen.getByRole('button', { name: 'Share backup file' }))
    await screen.findByText(/Backup ready/)
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^ccbill-old-backup-/) }))
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  it('blocks closing the sheet while it is working', async () => {
    const oldName = await seedOldDb(fixture())
    const db = freshNewDb()
    const old = (await readOldData(oldName))!
    await migrate(db, old, planMigration(old))
    let release = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <Shell db={db} oldName={oldName}>
        <DeleteOldSheet onClose={onClose} onDeleted={() => {}} save={save} />
      </Shell>,
    )
    await user.click(screen.getByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('sheet-overlay'))
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(save).toHaveBeenCalled())
    release()
    await screen.findByText(/Backup ready/)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
