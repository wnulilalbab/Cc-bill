// Rendering helpers for screen tests (jsdom + fake-indexeddb). Synthetic data only.
import { act, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { NewDb } from '../data/db'
import { Shell } from '../features/Shell'
import { pendingDbReads } from '../features/data/useDbQuery'
import { freshNewDb, uniqueName } from '../../test/data/oldDb'

export function renderScreen(ui: ReactNode, { db = freshNewDb(), oldName = uniqueName('CCBillDB-none') }: { db?: NewDb; oldName?: string } = {}) {
  const user = userEvent.setup()
  const result = render(
    <MemoryRouter>
      <Shell db={db} oldName={oldName}>
        {ui}
      </Shell>
    </MemoryRouter>,
  )
  return { ...result, user, db, oldName }
}

function LocationProbe() {
  const l = useLocation()
  return <output data-testid="location" hidden>{`${l.pathname}${l.search}`}</output>
}

/**
 * Renders several routed screens in one Shell, starting at `at`. `screen.getByTestId('location')` holds the current
 * path and query, so tests can follow links without a browser.
 */
export function renderRoutes(routes: Record<string, ReactNode>, at: string, { db = freshNewDb(), oldName = uniqueName('CCBillDB-none') }: { db?: NewDb; oldName?: string } = {}) {
  const user = userEvent.setup()
  const result = render(
    <MemoryRouter initialEntries={[at]}>
      <Shell db={db} oldName={oldName}>
        <Routes>
          {Object.entries(routes).map(([path, element]) => (
            <Route key={path} path={path} element={element} />
          ))}
          <Route path="*" element={<div>Elsewhere</div>} />
        </Routes>
        <LocationProbe />
      </Shell>
    </MemoryRouter>,
  )
  return { ...result, user, db, oldName }
}

/** A CSS custom property set on <html> by AppearanceProvider. */
export const token = (name: string) => document.documentElement.style.getPropertyValue(name)

/**
 * Waits until the screen is at rest: no database read of a screen is in flight, then lets React render what the last
 * read returned. Tests call it before they end (and before cleanup) so a read started by their last action, or the
 * re-read a write triggers, always finishes inside the test: the same renders run on every run, under any load.
 */
export async function settle(): Promise<void> {
  for (let quiet = 0; quiet < 2; ) {
    await waitFor(() => {
      if (pendingDbReads() !== 0) throw new Error(`${pendingDbReads()} database reads still running`)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    quiet = pendingDbReads() === 0 ? quiet + 1 : 0
  }
}
