# CC Bill — Shared Credit Card Expense Tracker

A personal PWA (Progressive Web App) to track, label, and split a shared BCA credit card bill between multiple owners (e.g. yourself, your spouse, and household expenses). Runs entirely in the browser — no backend, no server. Install it on Android and use it like a native app.

---

## The Problem

One credit card, used by multiple people (you, your wife, shared household). Every billing cycle brings confusion:

- Transaction descriptions are cryptic (`SHOPEE.CO.ID *AP1260114JAKARTA BARATID`) — impossible to know what was bought
- 0% installments (`CICILAN BCA KE 04 DARI 12, BLIBLI.COM 0%`) have no label — impossible to know what item they belong to
- BCA's installment conversion creates `REVERSAL` entry pairs that look like real charges but are not
- Payments are made before the bill arrives — when the bill comes, you don't know which items are already paid
- One payment often covers multiple expenses
- No clear answer to: "how much does each person owe this month?"

---

## The Solution

A browser-only PWA that:

1. Imports your BCA bill (PDF) and unbilled transactions (screenshots) using AI parsing
2. Lets you label each transaction and assign it to an owner (you / wife / us / any custom label)
3. Links installment lines back to the original purchase name
4. Lets you allocate payments to specific expenses so you always know what's paid
5. Gives you a clear per-owner breakdown every month

---

## Features

### Import
- Upload BCA credit card statement PDF (billed transactions)
- Upload BCA Mobile screenshots (unbilled transactions)
- AI-powered parsing via Claude API extracts: date, description, amount, transaction type
- Auto-detects transaction types: purchase, installment, payment, refund, reversal, fee, interest
- Reversal entry pairs are automatically hidden (they are BCA's internal installment conversion noise, not real charges)

### Label & Assign
- Add a human-readable label to each transaction ("Baby diapers", "Gym membership", "Dental checkup")
- Assign an owner / PIC to each transaction
- Owners are fully configurable — create any labels you want (default: Wahyu, Wife, Us)
- For installment lines: link to an Installment Plan so every monthly cicilan shows the original item name
- App learns from past labels — same merchant auto-suggests the same label next time

### Installment Plans
- Create a plan when a new installment starts: item name, total amount, number of months, monthly amount
- Every `CICILAN BCA KE X DARI Y` line auto-links to its plan
- Dashboard shows all active installments: item name, months remaining, monthly cost

### Payment Reconciliation
- Record payments as they happen (mid-cycle from screenshots)
- Payments go into a pool — unallocated until you assign them
- Allocate one payment across multiple expenses
- Each expense shows status: `Unpaid` / `Partially Paid` / `Paid`
- Running total of unallocated payment balance always visible

### Dashboard
- Total bill amount for current period
- Breakdown by owner: each person's total for the month
- Active installments summary
- Payment status: what's paid, what's outstanding
- Per-owner: how much still needs to be paid

### Settings
- Anthropic API key (stored in IndexedDB — stays on your device)
- Manage owners / PIC labels
- Export all data to JSON (manual backup)
- Import from JSON backup

---

## Owner / PIC System

Each transaction is tagged with exactly one owner. Owners are just labels — no splitting math, no percentages. You decide what the labels mean.

Default owners:
```
[ Wahyu ]  [ Wife ]  [ Us ]
```

You can rename, add, or delete owners freely from Settings. Example additions:
```
[ Business ]  [ Parents ]
```

Monthly summary example:
```
April 2026 Bill  —  Rp 6,248,348

  Wahyu   →  Rp 1,832,000
  Wife    →  Rp 1,161,000
  Us      →  Rp 3,255,348
```

---

## App Flow

```
┌─────────────────────────────────────────────────────┐
│  STEP 1: IMPORT                                     │
│                                                     │
│  Upload PDF (billed) → AI extracts all rows         │
│  Upload Screenshot (unbilled) → AI extracts rows    │
│                                                     │
│  Auto-detected types per row:                       │
│    purchase / installment / payment /               │
│    refund / reversal / fee / interest               │
│                                                     │
│  Reversal pairs → automatically hidden              │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  STEP 2: ENRICH                                     │
│                                                     │
│  For each purchase:                                 │
│    → Add label (what is this?)                      │
│    → Assign owner (who is responsible?)             │
│                                                     │
│  For each installment line:                         │
│    → Link to Installment Plan (auto if known)       │
│    → Or create new plan: item name + months         │
│                                                     │
│  AI suggests label + owner based on past data       │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  STEP 3: RECONCILE PAYMENTS                         │
│                                                     │
│  See all payments in pool (paid + unpaid)           │
│  Select which expenses each payment covers          │
│  Expenses flip to Paid status                       │
│  Remaining unallocated balance shown clearly        │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  STEP 4: DASHBOARD                                  │
│                                                     │
│  Total bill / by owner / by category                │
│  "Still to pay": per owner                          │
│  Active installments: item, X of Y months left      │
│  Payment status per expense                         │
└─────────────────────────────────────────────────────┘
```

---

## Screens

| Screen | Purpose |
|---|---|
| Dashboard | Monthly summary, per-owner totals, installment overview |
| Import | Upload PDF or screenshot, review parsed transactions |
| Transactions | List all transactions for a period, filter by owner/type/status |
| Enrich | Label a transaction, assign owner, link to installment plan |
| Installment Plans | Create and manage installment plan records |
| Payments | Payment pool, allocate payments to expenses |
| Settings | API key, manage owners, export/import data |

---

## Data Model

```
Owner
  id, name, color

BillPeriod
  id, month, year, source (pdf/screenshot), due_date, imported_at

Transaction
  id, period_id, date, description, amount, type
  type: purchase | installment | payment | refund | reversal | fee | interest

Expense
  id, transaction_id, label, owner_id, installment_plan_id, status
  status: unpaid | partial | paid

InstallmentPlan
  id, name, original_amount, total_months, monthly_amount, start_month, owner_id

Payment
  id, date, amount, note, period_id

PaymentAllocation
  id, payment_id, expense_id, amount

Settings
  anthropic_api_key, default_owner_id
```

---

## Known Edge Cases & How They're Handled

| Issue | What happens | Solution |
|---|---|---|
| BCA Reversal entries | Installment conversion creates a debit + immediate credit of same amount | Auto-detected by "REVERSAL" keyword + matching amount, hidden from view |
| Multiple Shopee purchases same day | Same merchant, different items | Each transaction labeled individually |
| 0% installment no item context | `CICILAN BCA KE X DARI Y` has no item name | Installment Plan links the monthly line to a named record |
| Payment made before bill | Payment visible in screenshot, not yet in PDF | Payment Pool holds it, allocated when bill arrives |
| One payment covers multiple items | e.g. Rp 1,925,000 covering 3 different expenses | Many-to-many allocation: one payment → multiple expenses |
| USD transactions | `CLAUDE.AI SUBSCRIPTION USD 20.00 x 17,320.95` | Store both original currency + IDR amount from bill |
| Interest charge (Biaya Bunga) | Appears when previous bill not fully paid | Flagged separately, tagged to owner or left as shared |
| New installment first month | BCA shows original charge + reversal + first cicilan | Reversal pair hidden, first cicilan linked to new plan |
| Carry-over balance | Saldo Sebelumnya from previous cycle | Displayed as reference, not double-counted |

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Framework | React + Vite | Static build, no server |
| Language | TypeScript | Type safety for financial data |
| Styling | Tailwind CSS | Mobile-first, touch-friendly |
| Storage | Dexie.js (IndexedDB) | Structured data, ~500MB limit, persistent |
| PDF Parsing | PDF.js | Extracts raw text from BCA PDF in-browser |
| AI | Claude API (Anthropic) | Parses extracted text + screenshots into structured data |
| PWA | vite-plugin-pwa + Workbox | Service worker, manifest, offline shell |
| Hosting | GitHub Pages | Free, HTTPS, required for PWA |

---

## Architecture

```
Android (installed PWA — Home Screen)
│
├── React UI (Vite static build)
│
├── Dexie.js → IndexedDB
│     ├── owners
│     ├── periods
│     ├── transactions
│     ├── expenses
│     ├── installment_plans
│     ├── payments
│     ├── payment_allocations
│     └── settings (incl. API key)
│
├── PDF.js
│     └── reads PDF → extracts raw text → sent to Claude
│
├── Claude API (direct from browser)
│     ├── input: raw PDF text or base64 image
│     └── output: structured JSON transaction list
│
└── Service Worker (vite-plugin-pwa)
      └── caches app shell for offline use

Hosting: GitHub Pages (HTTPS, free)
```

---

## PWA — Android Install

The app is a full PWA. On Android:

1. Open the app URL in Chrome
2. Chrome shows **"Add to Home Screen"** banner
3. Tap install — app appears on home screen like a native app
4. Opens fullscreen, no browser bar

### Web Share Target

After installing, the app registers as a share target on Android. This means you can share files directly into the app:

- Open **Files** app → find your BCA PDF → tap **Share** → select **CC Bill**
- Open **Gallery** → find your BCA Mobile screenshot → tap **Share** → select **CC Bill**

The app opens with the file ready to import — no manual file picker needed.

### Persistent Storage

On first launch, the app requests persistent storage:
```js
await navigator.storage.persist()
```
Android confirms with a prompt. After approval, IndexedDB data is never cleared by the OS automatically — same behavior as an installed native app.

---

## GitHub Pages Deployment

The app is hosted at: `https://<username>.github.io/Cc-bill/`

### Base URL Configuration

Vite requires the repo name as the base path for GitHub Pages:

```ts
// vite.config.ts
export default defineConfig({
  base: '/Cc-bill/',
  plugins: [
    react(),
    VitePWA({ ... })
  ]
})
```

### Deploy via GitHub Actions

`.github/workflows/deploy.yml` runs on every push to `main`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/deploy-pages@v4
```

Push to `main` → GitHub builds → live on GitHub Pages within ~1 minute.

---

## Local Development

```bash
git clone https://github.com/<username>/Cc-bill.git
cd Cc-bill
npm install
npm run dev        # http://localhost:5173
```

For PWA testing on real Android device during development:
```bash
npm run build && npm run preview -- --host
# opens on your local network IP → open on Android Chrome
```

---

## First-Time Setup (on device)

1. Open the app URL in Android Chrome
2. Install to Home Screen when prompted
3. Open the app → go to **Settings**
4. Paste your Anthropic API key
5. Add your owners (default: Wahyu, Wife, Us)
6. Done — start importing your first bill

---

## Data Backup

All data lives in your browser's IndexedDB. To back it up:

- **Settings → Export Data** → downloads `ccbill-backup-YYYY-MM-DD.json`
- **Settings → Import Data** → restores from a JSON backup file

Do this periodically, or before clearing browser data / switching devices.

---

## Limitations

- Data is local to the device and browser. Clearing browser storage deletes all data (use Export regularly).
- No cross-device sync. Use Export → Import to move data to another device.
- Anthropic API key is stored in IndexedDB (readable via DevTools). Acceptable for a personal device; clear from Settings if sharing the device.
- Web Share Target only works after the PWA is installed to Home Screen.
- GitHub Pages URL contains the repo path (`/Cc-bill/`). Setting a custom domain removes this.
