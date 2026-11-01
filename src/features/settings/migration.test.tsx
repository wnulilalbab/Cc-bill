// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIGRATED_CARD, planMigration, type Verification } from '../../data/migration'
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
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [] })
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
  it('G-04 confirm, then the JSON backup downloads, then the old database is deleted', async () => {
    const { user, oldName, db } = await openPreview()
    await user.click(screen.getByRole('button', { name: 'Confirm and migrate' }))
    await screen.findByText('Everything matches ✓')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    const migrated = await readAll(db)
    await user.click(await screen.findByRole('button', { name: 'Delete old data (downloads a backup first)' }))
    expect(screen.getByRole('dialog', { name: 'Delete old data?' })).toBeTruthy()

    // Cancel first: nothing happens.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await Dexie.exists(oldName)).toBe(true)

    const downloads: { existed: boolean; blob: Blob }[] = []
    let pending: Promise<void> = Promise.resolve()
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      pending = Dexie.exists(oldName).then((existed) => void downloads.push({ existed, blob: blob as Blob }))
      return 'blob:synthetic'
    })
    URL.revokeObjectURL = vi.fn()
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: 'Delete old data (downloads a backup first)' }))
    await user.click(screen.getByRole('button', { name: 'Download backup and delete' }))
    await screen.findByText('Backup downloaded, old data deleted')
    await pending
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].existed).toBe(true) // the backup was produced while the old DB still existed
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(downloads[0].blob)
    })
    const backup = JSON.parse(text)
    expect(backup.transactions).toHaveLength(expected.counts.transactions)
    expect(await Dexie.exists(oldName)).toBe(false)
    expect(await readAll(db)).toEqual(migrated) // the migrated data is not touched
    await screen.findByText('Old data deleted. Everything is in the new database.')
  })

  it('G-04 nothing is deleted when the backup cannot be saved or the migration did not verify', async () => {
    const oldName = await seedOldDb(fixture())
    const db = freshNewDb()
    const onDeleted = vi.fn()
    const r = render(
      <Shell db={db} oldName={oldName}>
        <DeleteOldSheet onClose={() => {}} onDeleted={onDeleted} save={() => Promise.reject(new Error('Disk full'))} />
      </Shell>,
    )
    screen.getByRole('button', { name: 'Download backup and delete' }).click()
    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was deleted. Old data can only be deleted after a migration has passed verification./)
    r.unmount()

    const old = (await readOldData(oldName))!
    const { migrate } = await import('../../data/migration')
    await migrate(db, old, planMigration(old))
    render(
      <Shell db={db} oldName={oldName}>
        <DeleteOldSheet onClose={() => {}} onDeleted={onDeleted} save={() => Promise.reject(new Error('Disk full'))} />
      </Shell>,
    )
    screen.getByRole('button', { name: 'Download backup and delete' }).click()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nothing was deleted. Disk full'))
    expect(await Dexie.exists(oldName)).toBe(true)
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
