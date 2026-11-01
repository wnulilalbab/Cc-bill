// Per-device preferences in env-prefixed localStorage (src/lib/storage.ts). Never part of a backup.
import { lsGet, lsRemove, lsSet } from '../../lib/storage'

export const PREF_KEYS = {
  selectedCard: 'v2_selected_card',
  look: 'v2_look',
  aiApiKey: 'v2_ai_api_key',
  aiModel: 'v2_ai_model',
  testingMode: 'testing_mode',
} as const

/** Reads a preference; null when storage is unavailable. */
export function prefGet(key: string): string | null {
  try {
    return lsGet(key)
  } catch {
    return null
  }
}

/** Writes a preference (`null` removes it). Silently ignored when storage is unavailable. */
export function prefSet(key: string, value: string | null): void {
  try {
    if (value === null) lsRemove(key)
    else lsSet(key, value)
  } catch {
    // Private window or blocked storage: the preference just isn't remembered.
  }
}
