import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import Transactions from './pages/Transactions'
import Installments from './pages/Installments'
import Payments from './pages/Payments'
import Settings from './pages/Settings'
import { GearIcon } from './components/icons'
import { Shell } from './features/Shell'
import { SettingsPage } from './features/settings/SettingsPage'
import { RulesPage } from './features/tagging/RulesPage'
import { ImportPage } from './features/import/ImportPage'
import { TransactionsPage } from './features/transactions/TransactionsPage'

function BottomNav() {
  const location = useLocation()

  const links = [
    { to: '/', label: 'Dashboard', icon: IconHome },
    { to: '/v2/import', label: 'Import', icon: IconUpload },
    { to: '/v2/transactions', label: 'Transactions', icon: IconList },
    { to: '/payments', label: 'Bayar', icon: IconCard },
    { to: '/v2/settings', label: 'Settings', icon: IconGear },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-safe">
      <div className="flex">
        {links.map(({ to, label, icon: Icon }) => {
          const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5"
            >
              <Icon className={active ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`text-[10px] font-medium ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                {label}
              </span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col">
        {__APP_ENV__ === 'staging' && (
          <div className="sticky top-0 z-50 bg-amber-500 text-white text-center text-xs font-bold py-1 tracking-wide">
            STAGING · test data only · v{__APP_VERSION__}
          </div>
        )}
        <main className="flex-1 pb-20">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/import" element={<Import />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/installments" element={<Installments />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/settings" element={<Settings />} />
            {/* Phase-1 screens (new database). The legacy screens above are replaced in later slices. */}
            <Route path="/v2/settings" element={<Shell><SettingsPage /></Shell>} />
            <Route path="/v2/rules" element={<Shell><RulesPage /></Shell>} />
            <Route path="/v2/import" element={<Shell><ImportPage /></Shell>} />
            <Route path="/v2/transactions" element={<Shell><TransactionsPage /></Shell>} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  )
}

function IconHome({ className = '' }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}
function IconUpload({ className = '' }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )
}
function IconList({ className = '' }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  )
}
function IconCard({ className = '' }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  )
}
function IconGear({ className = '' }) {
  // The prototype's gear (docs/intent/phase-1.md §2: a gear, not a sun-like glyph).
  return <GearIcon className={`w-5 h-5 ${className}`} />
}
