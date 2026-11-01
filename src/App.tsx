// The app: one Shell (databases, selected card + look, toasts) around every screen, the staging banner, the screens
// and the bottom nav. The short paths are canonical; /v2/... (the Phase-1 build-out paths) and the retired legacy
// screens redirect.
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './features/Shell'
import { BillPage } from './features/bill/BillPage'
import { PersonPage } from './features/bill/PersonPage'
import { ImportPage } from './features/import/ImportPage'
import { InsightsPage } from './features/insights/InsightsPage'
import { PaymentsRoutes } from './features/payments/PaymentsRoutes'
import { SettingsPage } from './features/settings/SettingsPage'
import { BottomNav } from './features/shell/BottomNav'
import { fromLegacy, PATHS } from './features/shell/paths'
import { isStaging, StagingBanner } from './features/shell/StagingBanner'
import { SharePage } from './features/share/SharePage'
import { RulesPage } from './features/tagging/RulesPage'
import { TransactionsPage } from './features/transactions/TransactionsPage'

function FromV2() {
  const { pathname, search } = useLocation()
  return <Navigate to={fromLegacy(pathname, search)} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={PATHS.bill} replace />} />
      <Route path={PATHS.bill} element={<BillPage />} />
      <Route path={`${PATHS.person}/:ownerId`} element={<PersonPage />} />
      <Route path={PATHS.transactions} element={<TransactionsPage />} />
      <Route path={`${PATHS.payments}/*`} element={<PaymentsRoutes />} />
      <Route path={PATHS.import} element={<ImportPage />} />
      <Route path={PATHS.settings} element={<SettingsPage />} />
      <Route path={PATHS.rules} element={<RulesPage />} />
      <Route path={PATHS.share} element={<SharePage />} />
      <Route path={PATHS.insights} element={<InsightsPage />} />
      <Route path="/v2/*" element={<FromV2 />} />
      {/* Retired legacy screens (/dashboard, /installments) and unknown paths go home. */}
      <Route path="*" element={<Navigate to={PATHS.bill} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Shell>
        <div className={`app${isStaging() ? ' staging' : ''}`}>
          <StagingBanner />
          <main>
            <AppRoutes />
          </main>
          <BottomNav />
        </div>
      </Shell>
    </HashRouter>
  )
}
