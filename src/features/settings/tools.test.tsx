// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_CACHE_PREFIX } from '../../data/aiCache'
import { exportNewBackup } from '../../data/backup'
import { saveCard } from '../../data/cards'
import { MIGRATED_CARD } from '../../data/migration'
import { readAll } from '../../data/repo'
import { renderScreen } from '../../test-utils/ui'
import { dumpIdb, fixture, freshNewDb, seedOldDb } from '../../../test/data/oldDb'
import { PREF_KEYS, prefGet, prefSet } from '../look/prefs'
import { DataProvider, useData } from '../data/DataContext'
import { useAppearance } from '../look/Appearance'
import { AI_MODELS, DEFAULT_AI_MODEL, maskKey, readAiSettings } from './aiSettings'
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

const SYNTHETIC_KEY = 'sk-ant-synthetic-0000-test-key-abcd'

async function testingOn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('switch', { name: 'Testing mode' }))
  expect(localStorage.getItem(PREF_KEYS.testingMode)).toBe('1')
}

describe('Settings → Testing', () => {
  it('G-05 tools are hidden until testing mode is on, and the switch is remembered', async () => {
    const { user } = renderScreen(<SettingsPage />)
    await screen.findByText('No old data on this phone.')
    expect(screen.queryByRole('button', { name: 'Load demo data' })).toBeNull()
    await testingOn(user)
    expect(screen.getByRole('button', { name: 'Load demo data' })).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: 'Testing mode' }))
    expect(localStorage.getItem(PREF_KEYS.testingMode)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load demo data' })).toBeNull()
  })

  it('G-05 load demo data, reset new data (old DB untouched), re-run migration', async () => {
    const oldName = await seedOldDb(fixture())
    const before = await dumpIdb(oldName)
    const db = freshNewDb()
    const { user } = renderScreen(<SettingsPage />, { db, oldName })
    await screen.findByText(/Old data found/)
    await testingOn(user)

    // Load demo data asks first and says what is lost; Cancel does nothing.
    await user.click(screen.getByRole('button', { name: 'Load demo data' }))
    expect(screen.getByText(/is erased and replaced by the synthetic demo household/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await db.cards.count()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Load demo data' }))
    await user.click(within(screen.getByText('Load demo data?').closest('.status') as HTMLElement).getByRole('button', { name: 'Load demo data' }))
    await screen.findByText('Demo data loaded: verified ✓')
    expect(await db.cards.get(MIGRATED_CARD.id)).toBeTruthy()
    await screen.findByText('BCA Shared')

    await user.click(screen.getByRole('button', { name: 'Reset new data' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await db.cards.count()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Reset new data' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await screen.findByText('New data reset')
    expect(await readAll(db)).toEqual({ cards: [], owners: [], statements: [], transactions: [], payments: [], plans: [] })
    expect(await dumpIdb(oldName)).toEqual(before)
    await screen.findByText(/No cards yet/)

    await user.click(screen.getByRole('button', { name: 'Re-run migration' }))
    expect(screen.getByText(/every change you made to them .* is lost/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await db.cards.count()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Re-run migration' }))
    await user.click(screen.getByRole('button', { name: 'Re-run' }))
    await screen.findByText('Migration re-run: verified ✓')
    expect(await db.cards.get(MIGRATED_CARD.id)).toBeTruthy()
    await screen.findByText('Old data migrated ✓ and kept as a backup.')
    expect(await dumpIdb(oldName)).toEqual(before)
  })

  it('G-05 re-run migration without old data shows the reason', async () => {
    const { user } = renderScreen(<SettingsPage />)
    await screen.findByText('No old data on this phone.')
    await testingOn(user)
    await user.click(screen.getByRole('button', { name: 'Re-run migration' }))
    await user.click(screen.getByRole('button', { name: 'Re-run' }))
    await screen.findByText('There is no old data to migrate.')
  })

  it('G-05 clear AI cache', async () => {
    const db = freshNewDb()
    await db.meta.bulkPut([{ key: `${AI_CACHE_PREFIX}file:v1`, value: '{}' }, { key: 'other', value: 1 }])
    const { user } = renderScreen(<SettingsPage />, { db })
    await screen.findByText('No old data on this phone.')
    await testingOn(user)
    await user.click(screen.getByRole('button', { name: 'Clear AI cache' }))
    await screen.findByText('AI cache cleared (1 removed)')
    expect((await db.meta.toArray()).map((m) => m.key)).toEqual(['other'])
  })

  it('G-05 inspect a record and delete it after a confirm step', async () => {
    const db = freshNewDb()
    const cardId = await saveCard(db, { name: 'Synthetic', bank: 'BCA', last4: '', statementDay: '', palette: 'blue', owners: [{ name: 'Andi', color: '#000000' }], defaultIndex: 0 })
    await db.transactions.put({ id: 'tx-syn-1', cardId, statementId: `${cardId}-unbilled`, date: '2026-10-01', description: 'SYNTHETIC SHOP', amount: 12000, kind: 'purchase', ownerId: null })
    const { user } = renderScreen(<SettingsPage />, { db })
    await screen.findByText('No old data on this phone.')
    await testingOn(user)

    expect((screen.getByRole('button', { name: 'Inspect' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Record id'), 'missing')
    await user.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(screen.getByText('No transactions record with id "missing".')).toBeTruthy()

    await user.clear(screen.getByLabelText('Record id'))
    await user.type(screen.getByLabelText('Record id'), 'tx-syn-1')
    await user.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(screen.getByLabelText('Record').textContent).toContain('SYNTHETIC SHOP')
    await user.click(screen.getByRole('button', { name: 'Delete this record' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await db.transactions.get('tx-syn-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Delete this record' }))
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await screen.findByText('Record deleted')
    expect(await db.transactions.get('tx-syn-1')).toBeUndefined()
    expect(screen.queryByLabelText('Record')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Table: Transactions' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Table' })).getByRole('option', { name: 'Cards' }))
    await user.clear(screen.getByLabelText('Record id'))
    await user.type(screen.getByLabelText('Record id'), cardId)
    await user.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(screen.getByLabelText('Record').textContent).toContain('"name": "Synthetic"')

    // A read error is shown, not thrown.
    vi.spyOn(db, 'table').mockImplementationOnce(() => {
      throw new Error('synthetic read failure')
    })
    await user.click(screen.getByRole('button', { name: 'Inspect' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the record: synthetic read failure')
    expect(screen.queryByLabelText('Record')).toBeNull()
  })
})

describe('Settings → AI', () => {
  it('stores the API key and model on this device only, never in the backup', async () => {
    const db = freshNewDb()
    await saveCard(db, { name: 'Synthetic', bank: 'BCA', last4: '', statementDay: '', palette: 'blue', owners: [{ name: 'Andi', color: '#000000' }], defaultIndex: 0 })
    const { user } = renderScreen(<SettingsPage />, { db })
    await screen.findByText('No old data on this phone.')
    expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Anthropic API key'), `  ${SYNTHETIC_KEY} `)
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    await screen.findByText('API key saved on this phone')
    expect(localStorage.getItem(PREF_KEYS.aiApiKey)).toBe(SYNTHETIC_KEY)
    expect(screen.getByText(maskKey(SYNTHETIC_KEY))).toBeTruthy()
    expect(screen.queryByDisplayValue(SYNTHETIC_KEY)).toBeNull()

    await user.click(screen.getByRole('button', { name: `Model: ${AI_MODELS[0].label}` }))
    await user.click(within(screen.getByRole('listbox', { name: 'Model' })).getByRole('option', { name: /Haiku 5.5/ }))
    expect(localStorage.getItem(PREF_KEYS.aiModel)).toBe('claude-haiku-5-5')

    const backup = await exportNewBackup(db)
    expect(backup).not.toContain(SYNTHETIC_KEY)
    expect(backup).not.toContain('claude-haiku-5-5')
    expect(JSON.stringify(await db.meta.toArray())).not.toContain(SYNTHETIC_KEY)

    await user.click(screen.getByRole('button', { name: 'Remove key' }))
    await screen.findByText('API key removed')
    expect(localStorage.getItem(PREF_KEYS.aiApiKey)).toBeNull()
  })

  it('uses env-prefixed keys on staging and falls back to the default model', () => {
    vi.stubGlobal('__APP_ENV__', 'staging')
    prefSet(PREF_KEYS.aiModel, 'not-a-model')
    expect(localStorage.getItem(`ccbill-staging:${PREF_KEYS.aiModel}`)).toBe('not-a-model')
    expect(localStorage.getItem(PREF_KEYS.aiModel)).toBeNull()
    expect(readAiSettings()).toEqual({ apiKey: '', model: DEFAULT_AI_MODEL })
    expect(maskKey('short')).toBe('••••')
  })

  it('works without storage (private window): preferences are just not remembered', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(prefGet('x')).toBeNull()
    expect(() => prefSet('x', 'y')).not.toThrow()
    expect(() => prefSet('x', null)).not.toThrow()
  })
})

describe('providers', () => {
  it('hooks explain a missing provider', () => {
    const Probe = ({ use }: { use: () => unknown }) => {
      use()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe use={useData} />)).toThrow('useData() needs a <DataProvider>.')
    expect(() =>
      render(
        <DataProvider db={freshNewDb()}>
          <Probe use={useAppearance} />
        </DataProvider>,
      ),
    ).toThrow('useAppearance() needs an <AppearanceProvider>.')
  })

  it('defaults to the environment databases', () => {
    let name = ''
    const Probe = () => {
      const { db, oldName } = useData()
      name = `${db.name}|${oldName}`
      return null
    }
    render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    )
    expect(name).toBe('ccbill-v2|CCBillDB')
  })
})

describe('Back button', () => {
  it('goes back in history, or home when Settings was opened directly', async () => {
    const { user } = renderScreen(<SettingsPage />)
    await screen.findByText('No old data on this phone.')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy())
  })
})
