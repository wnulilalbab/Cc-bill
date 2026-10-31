# Build progress

Kept by the Lead. Any session resumes from here. Rules: [`../intent/dev-loop.md`](../intent/dev-loop.md).

## Status

| Slice | State | PR | Notes |
|---|---|---|---|
| 0 Gate the deploy | in review | — | main → staging only; Release workflow skeleton; docs brought in |
| 1 Fixtures + harness + minimal CI | next | | |
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

- One-time GitHub setup (branch protection, allow auto-merge, `ANTHROPIC_API_KEY_CI`, Pages). Checklist will be posted when Slice 2 lands.

## Handover

Next: Slice 1 — synthetic fixture generator (BCA Jul–Nov PDFs, Mandiri screenshots Aug–Sep + locked PDFs Oct–Nov, unbilled screenshots, edge files, synthetic old backup) with expected-result files, plus Vitest harness and CI test job.
