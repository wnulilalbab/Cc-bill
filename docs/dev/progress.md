# Build progress

Kept by the Lead. Any session resumes from here. Rules: [`../intent/dev-loop.md`](../intent/dev-loop.md).

## Status

| Slice | State | PR | Notes |
|---|---|---|---|
| 0 Gate the deploy | **done** | #16 | main → staging only (verified on gh-pages: `staging/` published, root untouched); Release workflow skeleton |
| 1 Fixtures + harness + minimal CI | **done** | #17 | 5 BCA + 2 locked Mandiri PDFs, 2 Mandiri screenshot statements, 3 unbilled captures, corrupt + empty edge files, ~300-row old backup; 22 tests in CI |
| 2 Pipeline | **done** | #18 | `coverage` + `mutation` jobs, `review-gate` status, ESLint + node type-check in `ci`, staging Playwright smoke, hardened Release (`environment: release`, API check, tag after smoke), env-prefixed localStorage |
| 3 Money core | **done** | #20 | `src/domain/**`, 136 tests, 100% coverage; senior review: 2 must-fix found and fixed (linked payment edit, conversion conflict deposit) |
| 4 Database + migration | **done** | #22 | 3 review fixes: backup row validation, `beforeDelete` required, hostile-input errors |
| 5 Cards, owners, settings | **done** | #23 | two-step Delete old data (download, then confirm); confirms on destructive testing tools |
| 6 Import engine | **done** | #24 | redaction before AI, on-device totals cross-check, PDF caps, Forget password |
| 7 Tagging | **done** | #25 | rules never touch manual tags or paid rows; mutation 100% after a failed gate; perf guard |
| 8 Transactions | **done** | #26 | Keep/Unassign incl. deposit-paid rows; Fix-the-sign confirm |
| 9 Payments | **done** | #27 | full-screen assign, deposits, hand payments, actions |
| 10 Bill + person detail | **done** | #28 | rebate accept |
| 11 Share | **done** | #29 | image + WhatsApp text, Draft marker, Sent before |
| 12 App shell and look | **done** | #30 | carousel, card bar, prototype styling, legacy screens removed |
| 13 Insights preview, polish, full run | **in review** | branch `claude/slice-13-final` | Insights tab, open follow-ups, flaky-test fixes, Phase 1 scenario run (`npm run test:e2e:phase1`, also in `ci`), Slice 12 review items |

## Decisions log

- 2026-10-31 · Slice 0 is based on `main` (the live app, 28 commits ahead of the design branch). Commit `410d166` (payment-date filter, carried-over balance, auto-label rules, testing mode on the old app) is **not** merged: Phase 1 rebuilds all of it, and merging would mean resolving conflicts in four screens that Phase 1 replaces. It stays in git history on `claude/shared-expense-tracker-design-P8AmD`.
- 2026-10-31 · Until Slice 2 adds `review-gate` and branch protection, merges are done by the Lead after CI is green and the senior review approves (bootstrap exception, recorded on each PR).

- 2026-11-01 · PR #19: `.claude/settings.json` allows all tools (owner request); the old version-bump Stop hook is removed; `.claude/` is a security-review path.
- 2026-11-01 · Slice 3 product defaults (Lead, from the builder's questions and the senior review): unused refund credit carries forward and shows as `credit`; a missing hand payment blocks only statements **due** on or after its date (plus Unbilled); missing-payment grace = match window = 5 days; unknown credit lines (e.g. CASHBACK) stay `unknown` until the user picks; a hand payment next to an already-assigned bank line of the same amount is `possibleDuplicate` and keeps the bill Draft; wrong-sign rows are Draft issues; a conversion conflict clears the deposit owner ("Decide later"). Refund-netting in fill-oldest-first is phase 2 (`it.todo`).
- 2026-11-01 · Review markers posted by the Lead's app token do not start `issue_comment` runs, so `review-gate` also has `workflow_dispatch` (input `pr`); the Lead dispatches it after posting markers. PR #20 was Lead-merged after all checks passed and review approved, before this fix.

- 2026-11-01 · Slices 4–8 defaults (Lead): migration preview default owner starts at None; old API key is not migrated; card delete blocked while it has history; saving an import with a totals difference needs a confirm; printed date wins over file name (warning on mismatch); unknown credits must be picked; Remember PDF password off by default; Blibli not a marketplace (spec list + Bukalapak); a more specific rule wins silently, equal-specificity conflicts get Check; Keep payment records no inter-owner debt (phase 2); Mark reviewed turns Rule/AI tags into "You" (plan rows stay plan).
- 2026-11-01 · The repo's default branch is still `claude/shared-expense-tracker-design-P8AmD`, so `issue_comment` and dispatched review-gate runs use the wrong branch. Until the owner switches it to `main`, the Lead merges after all checks pass and the reviewers approve (markers posted on each PR).

- 2026-11-01 · Slice 13 (Builder): **Insights preview** shows *Spent by person*, *By kind*, *Top merchants* (5) and *Last statements* (6) for the selected statement, from `src/domain/insights` (effective amounts: cancelled purchases and reversals 0, refunds netted; payments never counted). The prototype's *Spent by category* is not built: no row has a category yet (the AI schema has none), so it waits for phase 2 with the category field. New test IDs N-01..N-04 in `docs/test-plan.md`.
- 2026-11-01 · Slice 13: the holder name is asked once, on the first statement PDF of a card without one (optional; empty = the page-1 guess); saved on the card (`setHolderName`).
- 2026-11-01 · Slice 13: redaction keeps amounts under Rp 1.000 printed without separators ("BEA METERAI 500") only on lines with two dates (transaction + booking), so a one-date address like "17 AGUSTUS RAYA NO 5" still never leaves the phone. Before this a Rp 500 stamp duty was dropped and showed as a totals difference.
- 2026-11-01 · Slice 13: `/bill/person/none` is an alias of `/bill/person/_none` unless an owner really has the id `none`. `/v2//host` paths collapse to one slash (never protocol-relative).
- 2026-11-01 · Slice 13: the migration refuses `totalMonths: 0` (and fractions) when reading the backup, and `applyMigration` runs `checkRecord` over every planned record before it writes anything.
- 2026-11-01 · Slice 13: UI tests end with `settle()` (`src/test-utils/ui.tsx`): it waits until no `useDbQuery` read is in flight (`pendingDbReads()`, a counter in `useDbQuery`), so the reads a test's last action starts finish inside that test. Three races fixed at the source: Rules "save error from the database" (the owner was deleted before the tap, so the sheet's own check or the database's answered depending on timing → the owner is now deleted inside the save), I-07 (waited on "Not counted", which a reversal shows before the conversion too → waits on the installment's "Paid"), the failed payment write (a concurrent delete the page could notice first → the write itself fails).
- 2026-11-01 · Slice 13: the Phase 1 scenario run (`e2e/phase1.spec.ts`, `playwright.phase1.config.ts`) builds staging, serves it with `vite preview`, runs at 390px, mocks `api.anthropic.com` with answers built from the fixtures' expected files and aborts any other non-localhost request (the run fails on any). It takes about 1 minute and passed 3 of 3 local runs, so it is a step of the `ci` job (after the staging build).
- 2026-11-01 · Slice 13 review items from Slice 12: Gear/Back keep their 38px look with a 44px hit area (`::after`, inset −3px); README stack and routes updated (no Tailwind); `@anthropic-ai/sdk` moved to devDependencies (only `scripts/release/api-check.ts` imports it); stale `src/db.ts` / `src/pages/Settings.tsx` comments fixed; routing test covers Settings, Rules and Share in the old-DB sweep and `/v2//evil.com` → `/bill`.

## Parked

None.

## Waiting for the owner

- ~~One-time GitHub setup~~ **done 2026-11-01**: ruleset `protect-main` (PR required, 0 approvals, required check `ci`, block force pushes, restrict deletions), auto-merge allowed, environment `release` (main only) with `ANTHROPIC_API_KEY_CI`. After Slice 2: add `coverage`, `mutation`, `review-gate` to the ruleset; release.yml must declare `environment: release`.
- Before opening staging on a phone that already has the app installed: run the **first Release** once. Until then the old production service worker (without the staging deny-list) can serve the production app at `/staging/`.

## Follow-ups for later slices

- Slice 3+: `src/domain/**` is empty, so `mutation` passes with "nothing to mutate" until Slice 3 adds the money core.
- Slice 5-12: delete the legacy screens from the `coverage.exclude` list in `vitest.config.ts` as each is replaced; add new folders to `eslint.config.js`.
- UI slices (from the Slice 3 review): negative fee rows (rebates) need an "accept" action or the statement stays Draft; "Keep waiting" on a possible duplicate must warn; explain why a conversion conflict sends leftover back to "Decide later".
- ~~Import: prompt for the card holder name on the first PDF import~~ **done (Slice 13)**; ~~test amounts under Rp 1.000~~ **done (Slice 13, and a redaction fix)**; pass the AI per-row owner guess into tagging: **deferred to phase 2**. The import draft cannot carry it cheaply: the AI answer has no owner field, so it needs a new schema field, the card's owner names in the prompt (family members' names leave the phone, a privacy choice for the owner) and a new prompt version (every cached answer and the Release API check change). `suggestOwners` already takes `aiGuess`, so only the import side is missing.
- Migration: ~~run `checkRecord` over `plan.data` in `applyMigration`; reject `totalMonths: 0`~~ **done (Slice 13)**; ~~legacy `src/db.ts` must stop recreating `CCBillDB`~~ done in Slice 12 (file removed).
- Staging shares the production origin (same localStorage/IndexedDB origin, env-prefixed names). Acceptable for now; revisit if staging ever runs untrusted code.
- ~~Transactions: add a UI test that drives the Fix-the-sign confirm~~ **done (Slice 13: flip and change-kind paths, with the bill each fix gives)**; the negative-fee "accept" action was done in Slice 10.
- ~~Accept `/bill/person/none` as an alias for no-owner~~ **done (Slice 13)**. ~~UTC "today" in AssignPage / TransactionsPage~~ **done** (TransactionsPage already used `localIsoDate`; AssignPage now does).
- Coverage: in 5 full `vitest --coverage` runs every file's covered lines, statements and functions are identical. Under heavy CPU load one number can still move: the **branch total** of `src/domain/payments.ts` (92 or 93, always 100% covered). It is not a test race: istanbul's branch map comes from V8 block ranges merged across test files in the order the files finish, and that order changes under load. Fixing it needs a newer `@vitest/coverage-v8` (AST-aware remapping); not done here.
- Golden flow E-05 (hand payment missing → keep waiting → resolved on next import) has no Playwright test; it is covered at integration level (P-14, P-15, `src/domain/scenarios.test.ts`, `src/import/flows.test.ts`).

## Phase 1 completion checklist

Success criteria of [`../intent/phase-1.md`](../intent/phase-1.md) and the test that proves each.

| # | Criterion | Test | Status |
|---|---|---|---|
| 1 | Every synthetic statement imports with totals matching its printed figures | I-01 (`src/import/fixtures.test.ts`, `src/import/flows.test.ts`); in the browser for BCA Jul–Nov, Mandiri Aug–Sep screenshots and Oct–Nov locked PDFs (`e2e/phase1.spec.ts`) | ✓ |
| 1b | The corrupted copy reports the exact difference | I-02 (`src/import/rows.test.ts`, `src/features/import/import.test.tsx`) | ✓ |
| 2 | Migration of the synthetic old backup verifies with identical counts and totals; old DB untouched | G-01, G-02, G-03 (`src/data/migration.test.ts`, `src/features/settings/migration.test.tsx`); E-04 in the browser (preview → confirm → "Everything matches ✓" → two-step delete) | ✓ |
| 3 | The five-minute loop (import → review → assign → bill → share) works end to end at 390px (Playwright) | `e2e/phase1.spec.ts`: E-01, E-03, E-04, E-02; Bill hero = bank balance (BCA 1.625.380, Mandiri 348.133); share text on the clipboard; U-02 no sideways scroll; runs in `ci` | ✓ |
| 4 | Every rule maps to at least one automated test in the test plan; coverage gates block deploys | Every ID in `docs/test-plan.md` has a test except E-05 (integration-level only, see follow-ups); gates in `vitest.config.ts`, `coverage` + `mutation` jobs | ✓ (E-05 e2e deferred) |

| Area | IDs | Where |
|---|---|---|
| Money and bill | M-01..M-11 | `src/domain/bill.test.ts`, `src/domain/scenarios.test.ts`, `src/features/bill/bill.test.tsx` |
| Draft / Final | F-01..F-10 | `src/domain/draft.test.ts`, `src/features/transactions/transactions.test.tsx`, `src/features/bill/bill.test.tsx` |
| Payments, deposits | P-01..P-19, D-01..D-05 | `src/domain/allocate.test.ts`, `src/domain/payments.test.ts`, `src/data/payments.test.ts`, `src/features/payments/payments.test.tsx` |
| Import | I-01..I-16 | `src/import/*.test.ts`, `src/features/import/import.test.tsx`, `e2e/phase1.spec.ts` |
| Tagging | T-01..T-09 | `src/domain/tagging/*.test.ts`, `src/data/rules.test.ts`, `src/features/tagging/tagging.test.tsx` |
| Transactions | X-01..X-08 | `src/features/transactions/transactions.test.tsx`, `src/data/transactions.test.ts` |
| Cards and owners | C-01..C-06 | `src/data/cards.test.ts`, `src/features/settings/cards.test.tsx` |
| Share | S-01..S-06 | `src/domain/share/*.test.ts`, `src/features/share/*.test.tsx` |
| Migration and data | G-01..G-06 | `src/data/*.test.ts`, `src/features/settings/*.test.tsx` |
| UI rules | U-01..U-08 | U-01/U-08 settings and bill tests; U-02 `e2e/phase1.spec.ts`; U-03 `cardbar.test.tsx`, `insights.test.tsx`; U-04 `src/features/language.test.ts`; U-05/U-06 `carousel.test.tsx`; U-07 `payments.test.tsx` |
| Insights preview | N-01..N-04 | `src/domain/insights/insights.test.ts`, `src/features/insights/insights.test.tsx` |
| Golden flows | E-01..E-04 | `e2e/phase1.spec.ts` (E-05: see follow-ups) |

Before **Ready to release ✓** (Lead): Slice 13 reviewed and merged; staging serves it; full Playwright suite (staging smoke) green on staging.

## Handover

Next: senior (and security: import redaction, AI payload) review of Slice 13, then Ready to release. Owner: switch the default branch to `main`; add `coverage`, `mutation`, `review-gate` to ruleset `protect-main`; run the first Release.
