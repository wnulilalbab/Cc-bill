// Re-runs a database read whenever any Dexie database in this tab is written (Dexie's "storagemutated" event).
// Simpler than liveQuery and independent of its promise-zone tracking.
import Dexie from 'dexie'
import { useEffect, useState } from 'react'

let pending = 0
/** Reads started by useDbQuery that have not finished yet. Tests wait for 0 before they end (src/test-utils/ui.tsx). */
export const pendingDbReads = () => pending

export function useDbQuery<T>(read: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    Dexie.on('storagemutated', bump)
    return () => Dexie.on('storagemutated').unsubscribe(bump)
  }, [])
  useEffect(() => {
    let live = true
    pending++
    read()
      .then(
        (v) => {
          if (live) setValue(v)
        },
        () => {},
      )
      .finally(() => pending--)
    return () => {
      live = false
    }
  }, [...deps, tick])
  return value
}
