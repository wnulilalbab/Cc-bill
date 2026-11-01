import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage {
  private m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, v)
  removeItem = (k: string) => void this.m.delete(k)
  keys = () => [...this.m.keys()]
}

describe('storageKey', () => {
  beforeEach(() => vi.stubGlobal('__APP_ENV__', 'production'))

  it('leaves production keys unprefixed', async () => {
    const { storageKey } = await import('./storage')
    expect(storageKey('testing_mode', 'production')).toBe('testing_mode')
  })
  it('prefixes staging keys', async () => {
    const { storageKey } = await import('./storage')
    expect(storageKey('testing_mode', 'staging')).toBe('ccbill-staging:testing_mode')
  })
  it('defaults to the build environment', async () => {
    const { storageKey } = await import('./storage')
    expect(storageKey('x')).toBe('x')
    vi.stubGlobal('__APP_ENV__', 'staging')
    expect(storageKey('x')).toBe('ccbill-staging:x')
  })
  it('lsGet/lsSet/lsRemove use the prefixed key on staging and never touch the production key', async () => {
    const store = new MemoryStorage()
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('__APP_ENV__', 'staging')
    const { lsGet, lsSet, lsRemove } = await import('./storage')
    lsSet('tx_filter_owner', 'a1')
    expect(store.keys()).toEqual(['ccbill-staging:tx_filter_owner'])
    expect(lsGet('tx_filter_owner')).toBe('a1')
    lsRemove('tx_filter_owner')
    expect(lsGet('tx_filter_owner')).toBeNull()
    expect(store.keys()).toEqual([])
  })
})
