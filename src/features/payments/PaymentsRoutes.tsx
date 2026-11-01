// /payments (the list), /payments/new (record by hand) and /payments/:paymentId (the full-screen assign page).
import { Route, Routes } from 'react-router-dom'
import { AssignPage } from './AssignPage'
import { PaymentsPage } from './PaymentsPage'

export function PaymentsRoutes() {
  return (
    <Routes>
      <Route index element={<PaymentsPage />} />
      <Route path="new" element={<AssignPage />} />
      <Route path=":paymentId" element={<AssignPage />} />
    </Routes>
  )
}
