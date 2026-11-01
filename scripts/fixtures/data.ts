// Single source of truth for the synthetic household used by every test.
// All people, cards, merchants and amounts here are fictional.

export type Kind = 'purchase' | 'installment' | 'fee' | 'interest' | 'payment' | 'refund' | 'reversal'
export type Bank = 'BCA' | 'Mandiri'

export interface Line {
  txDate: string // YYYY-MM-DD
  postDate: string
  description: string
  amount: number // integer rupiah, always positive; credit lines are kinds payment/refund/reversal
  kind: Kind
  expectedOwner: string | null // null for payments (assigned by the user later)
  needsCheck?: boolean // marketplace or low-confidence: app must show the Check dot
  installment?: { n: number; of: number; plan: string }
  reverses?: string // description of the purchase a reversal cancels
}

export interface Statement {
  file: string // base name, no extension
  card: CardId
  bank: Bank
  format: 'pdf' | 'screenshots'
  locked: boolean
  statementDate: string
  dueDate: string
  prevBalance: number
  lines: Line[]
}

export type CardId = 'bca' | 'mandiri'

export const PASSWORD = 'test1234'

export const household = {
  holder: 'ANDI PRATAMA',
  address: ['JL MELATI NO 7', 'KEL SUKAJADI', 'BANDUNG 40111'],
  cards: {
    bca: { name: 'BCA Keluarga', bank: 'BCA' as Bank, masked: '4556-77XX-XXXX-1234', customerNo: '10000001', owners: ['Andi', 'Sari', 'Bima', 'Keluarga', 'Medis'], defaultOwner: 'Keluarga' },
    mandiri: { name: 'Mandiri Pribadi', bank: 'Mandiri' as Bank, masked: '5299 12** **** 4321', customerNo: '20000002', owners: ['Andi', 'Rumah', 'Kantor'], defaultOwner: 'Andi' },
  },
}

const L = (txDate: string, postDate: string, description: string, amount: number, kind: Kind, expectedOwner: string | null, extra: Partial<Line> = {}): Line => ({
  txDate, postDate, description, amount, kind, expectedOwner, ...extra,
})

const garmin = (n: number, tx: string): Line =>
  L(tx, tx, `CICILAN BCA KE ${String(n).padStart(2, '0')} DARI 12, GARMIN INDONESIA`, 499917, 'installment', 'Andi', { installment: { n, of: 12, plan: 'Garmin Forerunner' } })
const blibli = (n: number, tx: string): Line =>
  L(tx, tx, `CICILAN BCA KE ${String(n).padStart(2, '0')} DARI 06, BLIBLI.COM`, 729367, 'installment', 'Sari', { installment: { n, of: 6, plan: 'Sepeda Statis (Blibli)' } })
const uniqlo = (n: number, tx: string): Line =>
  L(tx, tx, `UNIQLO AEON BSD ${String(n).padStart(3, '0')}/003`, 133333, 'installment', 'Andi', { installment: { n, of: 3, plan: 'Uniqlo AEON BSD' } })

// BCA: statement on the 12th, due on the 28th. Mandiri: statement on the 11th, due ~20 days later.
const bcaRaw: Omit<Statement, 'prevBalance'>[] = [
  {
    file: 'bca-2026-07', card: 'bca', bank: 'BCA', format: 'pdf', locked: false, statementDate: '2026-07-12', dueDate: '2026-07-28',
    lines: [
      L('2026-06-15', '2026-06-16', 'GRAB* A-1JUL01AAAA JAKARTA PUSATID', 9000, 'purchase', 'Andi'),
      L('2026-06-18', '2026-06-19', 'GRAB* A-1JUL02BBBB JAKARTA SELATID', 13000, 'purchase', 'Andi'),
      L('2026-06-20', '2026-06-20', 'NETFLIX.COM', 186000, 'purchase', 'Keluarga'),
      L('2026-06-22', '2026-06-23', 'INDOMARET CILANDAK', 245500, 'purchase', 'Keluarga'),
      garmin(1, '2026-06-25'),
      L('2026-07-01', '2026-07-02', 'GRAMEDIA MATRAMAN', 178000, 'purchase', 'Bima'),
      L('2026-07-05', '2026-07-06', 'RS PONDOK INDAH', 650000, 'purchase', 'Medis'),
      L('2026-07-12', '2026-07-12', 'BIAYA ADM KARTU', 15000, 'fee', 'Keluarga'),
    ],
  },
  {
    file: 'bca-2026-08', card: 'bca', bank: 'BCA', format: 'pdf', locked: false, statementDate: '2026-08-12', dueDate: '2026-08-28',
    lines: [
      L('2026-07-26', '2026-07-26', 'PEMBAYARAN - MBCA', 1000000, 'payment', null),
      L('2026-07-14', '2026-07-15', 'GRAB* A-1AUG01CCCC JAKARTA PUSATID', 9000, 'purchase', 'Andi'),
      L('2026-07-21', '2026-07-21', 'SHOPEE.CO.ID *AP1260721 JAKARTA BARATID', 355840, 'purchase', 'Sari', { needsCheck: true }),
      L('2026-07-21', '2026-07-21', 'SHOPEE.CO.ID *AP1260721 JAKARTA BARATID', 381327, 'purchase', 'Andi', { needsCheck: true }),
      L('2026-07-21', '2026-07-21', 'SHOPEE.CO.ID *AP1260721 JAKARTA BARATID', 1252000, 'purchase', 'Sari', { needsCheck: true }),
      garmin(2, '2026-07-25'),
      L('2026-07-28', '2026-07-28', 'NETFLIX.COM', 186000, 'purchase', 'Keluarga'),
      L('2026-08-02', '2026-08-02', 'REFUND SHOPEE.CO.ID *AP1260721', 381327, 'refund', 'Andi'),
      L('2026-08-12', '2026-08-12', 'BUNGA', 23508, 'interest', 'Keluarga'),
    ],
  },
  {
    file: 'bca-2026-09', card: 'bca', bank: 'BCA', format: 'pdf', locked: false, statementDate: '2026-09-12', dueDate: '2026-09-28',
    lines: [
      L('2026-08-27', '2026-08-27', 'PEMBAYARAN - MBCA', 3122682, 'payment', null),
      garmin(3, '2026-08-25'),
      L('2026-08-28', '2026-08-28', 'NETFLIX.COM', 186000, 'purchase', 'Keluarga'),
      L('2026-08-30', '2026-08-31', 'KIDZANIA JAKARTA', 760000, 'purchase', 'Bima'),
      L('2026-09-03', '2026-09-03', 'BLIBLI.COM *121 SEPEDA STATIS', 4376200, 'purchase', 'Sari'),
      L('2026-09-05', '2026-09-06', 'GRAB* A-1SEP01DDDD JAKARTA SELATID', 9000, 'purchase', 'Andi'),
      L('2026-09-12', '2026-09-12', 'BIAYA ADM KARTU', 15000, 'fee', 'Keluarga'),
    ],
  },
  {
    file: 'bca-2026-10', card: 'bca', bank: 'BCA', format: 'pdf', locked: false, statementDate: '2026-10-12', dueDate: '2026-10-28',
    lines: [
      L('2026-09-15', '2026-09-15', 'REVERSAL CICILAN BCA BLIBLI.COM *121', 4376200, 'reversal', 'Sari', { reverses: 'BLIBLI.COM *121 SEPEDA STATIS' }),
      blibli(1, '2026-09-15'),
      L('2026-09-25', '2026-09-25', 'WATSONS SENAYAN CITY', 200000, 'purchase', 'Sari'),
      garmin(4, '2026-09-25'),
      L('2026-09-26', '2026-09-26', 'PEMBAYARAN - MBCA', 200000, 'payment', null),
      L('2026-09-27', '2026-09-27', 'PEMBAYARAN - MBCA', 1470000, 'payment', null),
      L('2026-09-28', '2026-09-28', 'SHOPEE.CO.ID *AP1260928 JAKARTA BARATID', 150000, 'purchase', 'Sari', { needsCheck: true }),
      L('2026-09-28', '2026-09-28', 'SHOPEE.CO.ID *AP1260928 JAKARTA BARATID', 150000, 'purchase', 'Andi', { needsCheck: true }),
      L('2026-10-02', '2026-10-03', 'GRAMEDIA MATRAMAN', 245000, 'purchase', 'Bima'),
      L('2026-10-05', '2026-10-06', 'RS PONDOK INDAH', 1150000, 'purchase', 'Medis'),
      L('2026-10-08', '2026-10-08', 'NETFLIX.COM', 186000, 'purchase', 'Keluarga'),
      L('2026-10-12', '2026-10-12', 'BUNGA', 155895, 'interest', 'Keluarga'),
      L('2026-10-12', '2026-10-12', 'BIAYA ADM KARTU', 15000, 'fee', 'Keluarga'),
    ],
  },
  {
    file: 'bca-2026-11', card: 'bca', bank: 'BCA', format: 'pdf', locked: false, statementDate: '2026-11-12', dueDate: '2026-11-28',
    lines: [
      L('2026-10-20', '2026-10-20', 'PEMBAYARAN - MBCA', 2000000, 'payment', null),
      L('2026-10-30', '2026-10-30', 'PEMBAYARAN - MBCA', 1500000, 'payment', null),
      L('2026-10-14', '2026-10-15', 'GRAB* A-1NOV01EEEE JAKARTA PUSATID', 9000, 'purchase', 'Andi'),
      blibli(2, '2026-10-15'),
      L('2026-10-16', '2026-10-16', 'TOKOPEDIA JAKARTA', 320000, 'purchase', 'Sari', { needsCheck: true }),
      L('2026-10-18', '2026-10-18', 'HALODOC JAKARTA', 85000, 'purchase', 'Medis'),
      garmin(5, '2026-10-25'),
      L('2026-11-08', '2026-11-08', 'NETFLIX.COM', 186000, 'purchase', 'Keluarga'),
      L('2026-11-12', '2026-11-12', 'BIAYA ADM KARTU', 15000, 'fee', 'Keluarga'),
    ],
  },
]

const mandiriRaw: Omit<Statement, 'prevBalance'>[] = [
  {
    file: 'mandiri-2026-08', card: 'mandiri', bank: 'Mandiri', format: 'screenshots', locked: false, statementDate: '2026-08-11', dueDate: '2026-08-31',
    lines: [
      L('2026-07-14', '2026-07-15', 'KOPI SOE BLILI MART', 19800, 'purchase', 'Andi'),
      L('2026-07-20', '2026-07-21', 'TOKO LILI', 500000, 'purchase', 'Rumah'),
      L('2026-07-23', '2026-07-25', 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO USA', 75000, 'purchase', 'Kantor'),
      L('2026-08-01', '2026-08-02', 'Grab* A-2AUG01FFFF JAKARTA PUSAT IDN', 9000, 'purchase', 'Andi'),
    ],
  },
  {
    file: 'mandiri-2026-09', card: 'mandiri', bank: 'Mandiri', format: 'screenshots', locked: false, statementDate: '2026-09-11', dueDate: '2026-09-30',
    lines: [
      L('2026-08-31', '2026-08-31', 'PAYMENT THANK YOU - Livin', 603800, 'payment', null),
      L('2026-08-14', '2026-08-15', 'KOPI SOE BLILI MART', 39600, 'purchase', 'Andi'),
      L('2026-08-20', '2026-08-21', 'RK BUAH GROSIR, CIPUTAT', 130000, 'purchase', 'Rumah'),
      uniqlo(1, '2026-08-30'),
      L('2026-08-23', '2026-08-25', 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO USA', 75000, 'purchase', 'Kantor'),
    ],
  },
  {
    file: 'mandiri-2026-10', card: 'mandiri', bank: 'Mandiri', format: 'pdf', locked: true, statementDate: '2026-10-11', dueDate: '2026-10-31',
    lines: [
      L('2026-09-30', '2026-09-30', 'PAYMENT THANK YOU - Livin', 377933, 'payment', null),
      L('2026-09-23', '2026-09-25', 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO USA', 75000, 'purchase', 'Kantor'),
      uniqlo(2, '2026-09-30'),
      L('2026-10-03', '2026-10-04', 'Pondok Sate Kambing Muda', 283000, 'purchase', 'Rumah'),
      L('2026-10-05', '2026-10-06', 'SHOPEE Jakarta SelatID', 55201, 'purchase', 'Andi', { needsCheck: true }),
      L('2026-10-05', '2026-10-06', 'SHOPEE Jakarta SelatID', 44631, 'purchase', 'Rumah', { needsCheck: true }),
      L('2026-10-05', '2026-10-06', 'KCI C Access Topup', 100500, 'purchase', 'Andi'),
      L('2026-10-08', '2026-10-08', 'REFUND SHOPEE Jakarta SelatID', 44631, 'refund', 'Rumah'),
    ],
  },
  {
    file: 'mandiri-2026-11', card: 'mandiri', bank: 'Mandiri', format: 'pdf', locked: true, statementDate: '2026-11-11', dueDate: '2026-11-30',
    lines: [
      L('2026-10-31', '2026-10-31', 'PAYMENT THANK YOU - Livin', 647034, 'payment', null),
      uniqlo(3, '2026-10-30'),
      L('2026-11-01', '2026-11-02', 'KOPI SOE BLILI MART', 19800, 'purchase', 'Andi'),
      L('2026-11-04', '2026-11-04', 'Netflix.com Los Gatos SGP', 120000, 'purchase', 'Rumah'),
      L('2026-10-23', '2026-10-25', 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO USA', 75000, 'purchase', 'Kantor'),
    ],
  },
]

export const CREDIT_KINDS: Kind[] = ['payment', 'refund', 'reversal']
export const isCredit = (l: Line) => CREDIT_KINDS.includes(l.kind)

export interface Printed {
  prevBalance: number
  credits: number
  purchases: number
  feesInterest: number
  newBalance: number
  minPayment: number
}

export function printedTotals(prevBalance: number, lines: Line[]): Printed {
  const credits = lines.filter(isCredit).reduce((s, l) => s + l.amount, 0)
  const feesInterest = lines.filter((l) => l.kind === 'fee' || l.kind === 'interest').reduce((s, l) => s + l.amount, 0)
  const purchases = lines.filter((l) => l.kind === 'purchase' || l.kind === 'installment').reduce((s, l) => s + l.amount, 0)
  const newBalance = prevBalance - credits + purchases + feesInterest
  const minPayment = Math.max(0, Math.min(newBalance, Math.round(newBalance * 0.05 + feesInterest)))
  return { prevBalance, credits, purchases, feesInterest, newBalance, minPayment }
}

function chain(raw: Omit<Statement, 'prevBalance'>[]): Statement[] {
  let prev = 0
  return raw.map((s) => {
    const st = { ...s, prevBalance: prev }
    prev = printedTotals(prev, s.lines).newBalance
    return st
  })
}

export const statements: Statement[] = [...chain(bcaRaw), ...chain(mandiriRaw)]

// Edge-case statements derived from the main set.
const oct = statements.find((s) => s.file === 'bca-2026-10')!
export const corruptOct = {
  // Same printed totals as the real October, but GRAMEDIA is printed 1 rupiah higher.
  statement: { ...oct, file: 'bca-2026-10-corrupt' } as Statement,
  printed: printedTotals(oct.prevBalance, oct.lines),
  lines: oct.lines.map((l) => (l.description === 'GRAMEDIA MATRAMAN' ? { ...l, amount: l.amount + 1 } : l)),
  expectedDifference: 1,
}
export const emptyStatement: Statement = {
  file: 'bca-2026-12-empty', card: 'bca', bank: 'BCA', format: 'pdf', locked: false,
  statementDate: '2026-12-12', dueDate: '2026-12-28', prevBalance: 0, lines: [],
}

// Unbilled screenshots taken from the bank app between statements.
export interface UnbilledShot {
  file: string
  card: CardId
  capturedAt: string
  lines: Line[]
  note: string
}
export const unbilledShots: UnbilledShot[] = [
  {
    file: 'bca-unbilled-2026-10-10', card: 'bca', capturedAt: '2026-10-10',
    note: 'Before the Oct statement. Watsons was paid the next day (payment line). GRAB 27.000 on 9 Oct is a pending charge that never appears on any statement.',
    lines: [
      L('2026-09-25', '2026-09-25', 'WATSONS SENAYAN CITY', 200000, 'purchase', 'Sari'),
      L('2026-09-26', '2026-09-26', 'PEMBAYARAN - MBCA', 200000, 'payment', null),
      L('2026-10-02', '2026-10-03', 'GRAMEDIA MATRAMAN', 245000, 'purchase', 'Bima'),
      L('2026-10-09', '2026-10-09', 'GRAB* A-1PENDING JAKARTA PUSATID', 27000, 'purchase', 'Andi'),
    ],
  },
  {
    file: 'bca-unbilled-2026-10-20', card: 'bca', capturedAt: '2026-10-20',
    note: 'After the Oct statement. Includes a payment line (20 Oct) that later appears on the Nov statement.',
    lines: [
      L('2026-10-14', '2026-10-15', 'GRAB* A-1NOV01EEEE JAKARTA PUSATID', 9000, 'purchase', 'Andi'),
      L('2026-10-16', '2026-10-16', 'TOKOPEDIA JAKARTA', 320000, 'purchase', 'Sari', { needsCheck: true }),
      L('2026-10-18', '2026-10-18', 'HALODOC JAKARTA', 85000, 'purchase', 'Medis'),
      L('2026-10-20', '2026-10-20', 'PEMBAYARAN - MBCA', 2000000, 'payment', null),
    ],
  },
  {
    file: 'bca-unbilled-2026-10-20-overlap', card: 'bca', capturedAt: '2026-10-20',
    note: 'A second screenshot of the same screen, scrolled: repeats TOKOPEDIA and HALODOC (the same rows seen twice, not new purchases).',
    lines: [
      L('2026-10-16', '2026-10-16', 'TOKOPEDIA JAKARTA', 320000, 'purchase', 'Sari', { needsCheck: true }),
      L('2026-10-18', '2026-10-18', 'HALODOC JAKARTA', 85000, 'purchase', 'Medis'),
    ],
  },
]

// App-level facts the user enters by hand (not on any document). Later slices test against these.
export const handRecorded = {
  payments: [
    { card: 'bca', date: '2026-09-05', amount: 300000, owner: 'Bima', note: 'Never appears on any statement (missing-payment scenario).' },
    { card: 'bca', date: '2026-10-18', amount: 2000000, owner: 'Andi', note: 'Matches PEMBAYARAN 20 Oct 2.000.000 on the Nov statement (within ±5 days).' },
  ],
  scenarios: [
    'Aug: payment 1.000.000 leaves an unpaid balance carried into later bills.',
    'Sep: PEMBAYARAN 3.122.682 is one transfer covering several people.',
    'Oct: REVERSAL CICILAN cancels the Sep Blibli purchase (4.376.200); CICILAN 01/06 starts at 729.367.',
    'Oct: Watsons 200.000 paid the day after purchase (Unbilled payment line, printed on Oct).',
    'Oct: two SHOPEE 150.000 on 28 Sep are a genuine duplicate (two orders): keep both.',
    'Nov: PEMBAYARAN 30 Oct 1.500.000 is more than Sari owes; the leftover becomes her deposit.',
  ],
}
