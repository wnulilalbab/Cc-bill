// AI key and model for the import engine. Kept in env-prefixed localStorage on this device only: never in the
// database, so never in an export or backup.
import { PREF_KEYS, prefGet, prefSet } from '../look/prefs'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', desc: 'Most capable · recommended' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', desc: 'Balanced · cheaper' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', desc: 'Fast · cheapest' },
] as const

export const DEFAULT_AI_MODEL = 'claude-opus-5-5'

export interface AiSettings {
  apiKey: string
  model: string
}

export function readAiSettings(): AiSettings {
  const model = prefGet(PREF_KEYS.aiModel)
  return { apiKey: prefGet(PREF_KEYS.aiApiKey) ?? '', model: AI_MODELS.some((m) => m.id === model) ? model! : DEFAULT_AI_MODEL }
}

export function saveAiKey(apiKey: string): void {
  prefSet(PREF_KEYS.aiApiKey, apiKey.trim() || null)
}

export function saveAiModel(model: string): void {
  prefSet(PREF_KEYS.aiModel, model)
}

/** "sk-ant-…a1b2": enough to recognise the key without showing it. */
export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`
}
