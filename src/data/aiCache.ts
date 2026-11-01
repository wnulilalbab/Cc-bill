// Cached AI responses live in the new database's meta table under this prefix (keyed by file hash + prompt version,
// written by the import engine). Never part of the JSON backup, which only holds the data tables.
import type { NewDb } from './db'

export const AI_CACHE_PREFIX = 'ai-cache:'

/** Removes every cached AI response; returns how many were removed. */
export async function clearAiCache(db: NewDb): Promise<number> {
  return db.meta.where('key').startsWith(AI_CACHE_PREFIX).delete()
}
