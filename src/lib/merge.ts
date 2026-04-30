import type { ParsedTransaction, Transaction } from '../types'

export interface MatchPair {
  parsed: ParsedTransaction
  unbilled: Transaction
  score: number
}

export interface MergePlan {
  matched: MatchPair[]
  newOnes: ParsedTransaction[]
}

export interface DedupeResult {
  kept: ParsedTransaction[]
  skipped: ParsedTransaction[]
}

function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function descSimilarity(a: string, b: string): number {
  const na = normalizeDesc(a)
  const nb = normalizeDesc(b)
  if (na === nb) return 100
  if (na.includes(nb) || nb.includes(na)) return 80
  const wordsA = na.split(' ').filter((w) => w.length > 2)
  const wordsB = new Set(nb.split(' ').filter((w) => w.length > 2))
  if (wordsA.length === 0 || wordsB.size === 0) return 0
  const common = wordsA.filter((w) => wordsB.has(w)).length
  return common > 0 ? Math.min(70, 40 + common * 15) : 0
}

function daysDiff(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000
}

function matchScore(parsed: ParsedTransaction, tx: Transaction): number {
  if (parsed.amount !== tx.amount) return 0
  if (daysDiff(parsed.date, tx.date) > 45) return 0
  return descSimilarity(parsed.description, tx.description)
}

// Match each parsed PDF transaction to the best unbilled transaction.
// Each unbilled tx can only be matched once (greedy, highest score first).
// Threshold: score >= 60.
export function buildMergePlan(
  parsed: ParsedTransaction[],
  pool: Transaction[]
): MergePlan {
  const available = [...pool]
  const matched: MatchPair[] = []
  const newOnes: ParsedTransaction[] = []

  for (const p of parsed) {
    let bestScore = 59
    let bestIdx = -1

    for (let i = 0; i < available.length; i++) {
      const score = matchScore(p, available[i])
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      matched.push({ parsed: p, unbilled: available[bestIdx], score: bestScore })
      available.splice(bestIdx, 1)
    } else {
      newOnes.push(p)
    }
  }

  return { matched, newOnes }
}

// Remove duplicates from incoming transactions:
//   1. Within the batch itself (same amount + desc + date ±1 day)
//   2. Against already-saved unbilled transactions in the DB
export function deduplicateUnbilled(
  incoming: ParsedTransaction[],
  existingUnbilled: Transaction[]
): DedupeResult {
  const kept: ParsedTransaction[] = []
  const skipped: ParsedTransaction[] = []

  for (const tx of incoming) {
    const na = normalizeDesc(tx.description)

    const dupInBatch = kept.find(
      (k) =>
        k.amount === tx.amount &&
        normalizeDesc(k.description) === na &&
        daysDiff(k.date, tx.date) <= 1
    )
    if (dupInBatch) { skipped.push(tx); continue }

    const dupInDB = existingUnbilled.find(
      (e) =>
        e.amount === tx.amount &&
        normalizeDesc(e.description) === na &&
        daysDiff(e.date, tx.date) <= 1
    )
    if (dupInDB) { skipped.push(tx); continue }

    kept.push(tx)
  }

  return { kept, skipped }
}
