# Build progress

Kept by the Lead. Any session resumes from here. Rules: [`../intent/dev-loop.md`](../intent/dev-loop.md).

## Status

| Slice | State | PR | Notes |
|---|---|---|---|
| 0 Gate the deploy | **done** | #16 | main → staging only (verified on gh-pages: `staging/` published, root untouched); Release workflow skeleton |
| 1 Fixtures + harness + minimal CI | in review | | 5 BCA + 2 locked Mandiri PDFs, 2 Mandiri screenshot statements, 3 unbilled captures, corrupt + empty edge files, ~300-row old backup; 22 tests in CI |
| 2 Pipeline | queued | | |
| 3 Money core | queued | | |
| 4 Database + migration | queued | | |
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

## Parked

None.

## Waiting for the owner

- ~~One-time GitHub setup~~ **done 2026-11-01**: ruleset `protect-main` (PR required, 0 approvals, required check `ci`, block force pushes, restrict deletions), auto-merge allowed, environment `release` (main only) with `ANTHROPIC_API_KEY_CI`. After Slice 2: add `coverage`, `mutation`, `review-gate` to the ruleset; release.yml must declare `environment: release`.
- Before opening staging on a phone that already has the app installed: run the **first Release** once. Until then the old production service worker (without the staging deny-list) can serve the production app at `/staging/`.

## Follow-ups for later slices

- Slice 2: Release checks must **fail** (not warn) when `ANTHROPIC_API_KEY_CI` is missing.
- Slice 2: put `ANTHROPIC_API_KEY_CI` in a GitHub **Environment** restricted to `main` (so a Release dispatched from another branch can't use it); pin `peaceiris/actions-gh-pages` to a commit SHA.
- Slice 2: create the tag/release only after the production smoke test passes.
- Slice 2: type-check `scripts/` and `test/` in CI (Vitest transpiles without type checking; `tsc` only covers `src/`).
- Shared origin: `localStorage` keys (`testing_mode`, `tx_filter_*`, and any new ones) must be environment-prefixed on staging so they never leak into production.

## Handover

Next: Slice 2 — pipeline (coverage gates, mutation, review-gate, staging Playwright, full Release workflow with `environment: release`).
