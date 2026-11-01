# Build progress

Kept by the Lead. Any session resumes from here. Rules: [`../intent/dev-loop.md`](../intent/dev-loop.md).

## Status

| Slice | State | PR | Notes |
|---|---|---|---|
| 0 Gate the deploy | **done** | #16 | main → staging only (verified on gh-pages: `staging/` published, root untouched); Release workflow skeleton |
| 1 Fixtures + harness + minimal CI | **done** | #17 | 5 BCA + 2 locked Mandiri PDFs, 2 Mandiri screenshot statements, 3 unbilled captures, corrupt + empty edge files, ~300-row old backup; 22 tests in CI |
| 2 Pipeline | **done** | #18 | `coverage` + `mutation` jobs, `review-gate` status, ESLint + node type-check in `ci`, staging Playwright smoke, hardened Release (`environment: release`, API check, tag after smoke), env-prefixed localStorage |
| 3 Money core | **done** | #20 | `src/domain/**`, 136 tests, 100% coverage; senior review: 2 must-fix found and fixed (linked payment edit, conversion conflict deposit) |
| 4 Database + migration | built, PR next | | `src/data/**`, 62 tests; needs senior + security review |
| 5 Cards, owners, settings | queued | | |
| 6 Import engine | queued | | |
| 7 Tagging | queued | | |
| 8 Transactions | queued | | |
| 9 Payments | queued | | |
| 10 Bill + person detail | queued | | |
| 11 Share | queued | | |
| 12 App shell and look | queued | | |
| 13 Insights preview, polish, full run | queued | | |

## Decisions log

- 2026-10-31 · Slice 0 is based on `main` (the live app, 28 commits ahead of the design branch). Commit `410d166` (payment-date filter, carried-over balance, auto-label rules, testing mode on the old app) is **not** merged: Phase 1 rebuilds all of it, and merging would mean resolving conflicts in four screens that Phase 1 replaces. It stays in git history on `claude/shared-expense-tracker-design-P8AmD`.
- 2026-10-31 · Until Slice 2 adds `review-gate` and branch protection, merges are done by the Lead after CI is green and the senior review approves (bootstrap exception, recorded on each PR).

- 2026-11-01 · PR #19: `.claude/settings.json` allows all tools (owner request); the old version-bump Stop hook is removed; `.claude/` is a security-review path.
- 2026-11-01 · Slice 3 product defaults (Lead, from the builder's questions and the senior review): unused refund credit carries forward and shows as `credit`; a missing hand payment blocks only statements **due** on or after its date (plus Unbilled); missing-payment grace = match window = 5 days; unknown credit lines (e.g. CASHBACK) stay `unknown` until the user picks; a hand payment next to an already-assigned bank line of the same amount is `possibleDuplicate` and keeps the bill Draft; wrong-sign rows are Draft issues; a conversion conflict clears the deposit owner ("Decide later"). Refund-netting in fill-oldest-first is phase 2 (`it.todo`).
- 2026-11-01 · Review markers posted by the Lead's app token do not start `issue_comment` runs, so `review-gate` also has `workflow_dispatch` (input `pr`); the Lead dispatches it after posting markers. PR #20 was Lead-merged after all checks passed and review approved, before this fix.

## Parked

None.

## Waiting for the owner

- ~~One-time GitHub setup~~ **done 2026-11-01**: ruleset `protect-main` (PR required, 0 approvals, required check `ci`, block force pushes, restrict deletions), auto-merge allowed, environment `release` (main only) with `ANTHROPIC_API_KEY_CI`. After Slice 2: add `coverage`, `mutation`, `review-gate` to the ruleset; release.yml must declare `environment: release`.
- Before opening staging on a phone that already has the app installed: run the **first Release** once. Until then the old production service worker (without the staging deny-list) can serve the production app at `/staging/`.

## Follow-ups for later slices

- Slice 3+: `src/domain/**` is empty, so `mutation` passes with "nothing to mutate" until Slice 3 adds the money core.
- Slice 5-12: delete the legacy screens from the `coverage.exclude` list in `vitest.config.ts` as each is replaced; add new folders to `eslint.config.js`.
- UI slices (from the Slice 3 review): negative fee rows (rebates) need an "accept" action or the statement stays Draft; "Keep waiting" on a possible duplicate must warn; explain why a conversion conflict sends leftover back to "Decide later".
- Slice 6: extend `scripts/release/api-check.ts` to parse the synthetic statements.

## Handover

Next: Slice 4 PR (DB + migration) with senior + security review; then Slice 5. Owner: add `coverage`, `mutation`, `review-gate` to ruleset `protect-main`.
