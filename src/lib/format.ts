export function formatRupiah(amount: number): string {
  return `Rp ${Math.abs(amount).toLocaleString('id-ID')}`
}

export function formatRupiahCompact(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) {
    const val = abs / 1_000_000
    return `Rp ${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}jt`
  }
  if (abs >= 1_000) {
    return `Rp ${(abs / 1_000).toFixed(0)}rb`
  }
  return `Rp ${abs.toLocaleString('id-ID')}`
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

export function periodLabel(month: number, year: number): string {
  const d = new Date(year, month - 1, 1)
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export const OWNER_COLOR_CLASSES: Record<string, { bg: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  pink:   { bg: 'bg-pink-100',   text: 'text-pink-700',   dot: 'bg-pink-500'   },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  green:  { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500'  },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  teal:   { bg: 'bg-teal-100',   text: 'text-teal-700',   dot: 'bg-teal-500'   },
  red:    { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'    },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
}

export const TX_TYPE_LABEL: Record<string, string> = {
  purchase:    'Purchase',
  installment: 'Cicilan',
  payment:     'Payment',
  refund:      'Refund',
  reversal:    'Reversal',
  fee:         'Fee',
  interest:    'Interest',
}

export const TX_TYPE_COLOR: Record<string, string> = {
  purchase:    'bg-gray-100 text-gray-600',
  installment: 'bg-blue-100 text-blue-700',
  payment:     'bg-green-100 text-green-700',
  refund:      'bg-teal-100 text-teal-700',
  reversal:    'bg-gray-100 text-gray-400',
  fee:         'bg-red-100 text-red-700',
  interest:    'bg-red-100 text-red-700',
}

export interface InstallmentInfo {
  currentMonth: number  // ke X
  totalMonths: number   // dari Y
  startPeriod: string   // "YYYY-MM"
  endPeriod: string     // "YYYY-MM"
  monthlyAmount: number
  originalAmount: number
}

export function parseInstallmentDescription(
  description: string,
  amount: number,
  billYear: number,
  billMonth: number
): InstallmentInfo | null {
  const match = description.match(/CICILAN\s+BCA\s+KE\s+(\d+)\s+DARI\s+(\d+)/i)
  if (!match) return null

  const currentMonth = parseInt(match[1])
  const totalMonths = parseInt(match[2])
  const monthlyAmount = Math.abs(amount)

  // Start = bill period − (currentMonth − 1) months
  const startDate = new Date(billYear, billMonth - 1 - (currentMonth - 1))
  const startPeriod = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`

  // End = bill period + (totalMonths − currentMonth) months
  const endDate = new Date(billYear, billMonth - 1 + (totalMonths - currentMonth))
  const endPeriod = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`

  return {
    currentMonth,
    totalMonths,
    startPeriod,
    endPeriod,
    monthlyAmount,
    originalAmount: monthlyAmount * totalMonths,
  }
}

export function periodLabelFromKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}
