// Which databases the new screens use. The app uses the environment's databases; tests pass their own.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getNewDb, type NewDb } from '../../data/db'
import { oldDbName } from '../../data/env'

export interface DataEnv {
  db: NewDb
  /** Name of the old (pre-Phase-1) database. */
  oldName: string
}

const Ctx = createContext<DataEnv | null>(null)

export function DataProvider({ db, oldName, children }: { db?: NewDb; oldName?: string; children: ReactNode }) {
  const value = useMemo(() => ({ db: db ?? getNewDb(), oldName: oldName ?? oldDbName() }), [db, oldName])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataEnv {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData() needs a <DataProvider>.')
  return v
}
