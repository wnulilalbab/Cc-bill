// Wraps a Phase-1 screen: databases, selected card + look, toasts, and the scoped styles.
import type { ReactNode } from 'react'
import type { NewDb } from '../data/db'
import { ToastProvider } from '../components/Toast'
import { DataProvider } from './data/DataContext'
import { AppearanceProvider } from './look/Appearance'
import './ccb.css'

export function Shell({ children, db, oldName }: { children: ReactNode; db?: NewDb; oldName?: string }) {
  return (
    <DataProvider db={db} oldName={oldName}>
      <AppearanceProvider>
        <div className="ccb">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </AppearanceProvider>
    </DataProvider>
  )
}
