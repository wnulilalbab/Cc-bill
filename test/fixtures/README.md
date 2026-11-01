# Synthetic fixtures

Everything here is **fictional** (household "Andi Pratama"). No real statements, names or backups are used anywhere in testing. See [`docs/intent/dev-loop.md`](../../docs/intent/dev-loop.md#test-data).

Source of truth: `scripts/fixtures/data.ts`. Regenerate with `npm run fixtures` (PDFs — locked ones too, via a seeded random source — expected results, backup) and `npm run fixtures:screens` (PNG screenshots, needs Playwright's Chromium). `test/fixtures.test.ts` fails if a committed file drifts from the generator.

| Path | What | Tests it enables |
|---|---|---|
| `statements/bca-2026-07..11.pdf` | BCA Keluarga statements Jul–Nov, tables split across pages | Import, totals check, CR classification, installments, Unbilled merge |
| `statements/mandiri-2026-10..11.pdf` | Mandiri Pribadi statements, **password `test1234`** | Locked-PDF unlock, refund handling |
| `statements/bca-2026-10-corrupt.pdf` | October with GRAMEDIA printed 1 rupiah higher | Totals check reports the exact difference |
| `statements/bca-2026-12-empty.pdf` | Statement with no transactions | Empty-statement handling |
| `screenshots/mandiri-2026-08/09-p*.png` | Statement pages as app screenshots | Backfill from screenshots with a typed total |
| `unbilled/*.png` | Bank-app "unbilled" screens, incl. payment lines, a never-billed pending charge and an overlapping capture | Unbilled import, dedupe, payment lines, not-on-statement |
| `backup/old-backup.json` | Export in the current app's format (~300 transactions, Unknown owner, partial payments) | Migration and its verification |
| `*.expected.json` | Rows (credits negative), expected owner, Check flags, printed totals | Assertions for every test above |
| `household.json` | Cards, owners, password, hand-recorded payments and scenario notes | App-level scenarios (missing payment, ±5-day match, deposit) |
