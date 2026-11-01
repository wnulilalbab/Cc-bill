// Staging and production are served from the same origin (wnulilalbab.github.io), so they share
// localStorage. Every key goes through storageKey() so staging can never read or clobber production.
export const STAGING_PREFIX = 'ccbill-staging:'

export function storageKey(key: string, env: 'staging' | 'production' = __APP_ENV__): string {
  return env === 'staging' ? STAGING_PREFIX + key : key
}

export const lsGet = (key: string) => localStorage.getItem(storageKey(key))
export const lsSet = (key: string, value: string) => localStorage.setItem(storageKey(key), value)
export const lsRemove = (key: string) => localStorage.removeItem(storageKey(key))
