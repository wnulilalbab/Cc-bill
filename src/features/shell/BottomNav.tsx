// Bottom navigation (prototype `tabbar()`): Bill · Transactions · (+) Import · Payments · Insights (preview). Settings
// is the gear in the top bar.
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { BillIcon, ChartIcon, ListIcon, PayIcon, PlusIcon } from '../../components/icons'
import { PATHS } from './paths'

const TABS: { to: string; label: string; icon: ReactNode; plus?: boolean }[] = [
  { to: PATHS.bill, label: 'Bill', icon: <BillIcon /> },
  { to: PATHS.transactions, label: 'Transactions', icon: <ListIcon /> },
  { to: PATHS.import, label: 'Import', icon: <PlusIcon />, plus: true },
  { to: PATHS.payments, label: 'Payments', icon: <PayIcon /> },
  { to: PATHS.insights, label: 'Insights', icon: <ChartIcon /> },
]

export function BottomNav() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        // NavLink sets aria-current="page" on the active tab (and its sub-screens, e.g. a person's bill).
        <NavLink key={t.to} to={t.to} className={t.plus ? 'plus' : undefined}>
          <span className="ic">{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
