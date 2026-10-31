# CC Bill — development loop (locked)

Confirmed by the owner on 31 Oct 2026 after interview and roast. Product scope: [`phase-1.md`](phase-1.md). Test contract: [`../test-plan.md`](../test-plan.md).

## Goal

What ships to the owner's phone behaves as specified. Every scenario has an automated test that must pass. Tokens are spent only where a deterministic tool can't do the job. The owner reviews no code; the owner only presses **Release**.

## Roles

| Role | Does | Never |
|---|---|---|
| **Lead** | Picks the next slice by urgency; after each failed fix decides *keep fixing / park / ask owner / stop session*; tracks the 5-hour usage window; keeps `docs/dev/progress.md` | Releases; lowers a gate; skips or disables a test |
| **Builder** | Implements one slice: code + tests with test-plan IDs | Reviews its own work |
| **Senior reviewer** | Fresh agent; sees only diff + `phase-1.md` + `test-plan.md` + touched files. Checklist: matches intent, every new behaviour tested with its ID, tests assert outcomes, no shortcuts/dead code, money in integer rupiah | Edits code |
| **Security reviewer** | Same isolation; runs only when the diff touches import, AI payload, storage/passwords, or rendering of statement text. Checklist: no XSS from statement text, header stripping before AI calls, password encrypted at rest, no secrets, risky dependencies | Edits code |
| **Deterministic tools (0 tokens)** | `tsc`, ESLint, Vitest + coverage gates, Stryker mutation tests (money core), Playwright, `npm audit`, CodeQL, secret scanning | — |

Model use: cheaper model for routine slices and reviews; stronger model for money core, migration and security reviews. Max **2 review rounds** per PR, then the Lead decides.

## Lead decision rules

- **Keep fixing**: the failure narrows each attempt *and* blocks urgent work. Cap: 3 attempts or ~20 minutes per failure.
- **Park and move on**: not narrowing, or nothing depends on it. Record in `progress.md`, switch to the most urgent unblocked slice.
- **Ask owner** (only that item waits): ambiguous/conflicting requirement, missing fixture or secret, a product choice, or any "fix" that would weaken a test or gate.
- **Stop session early**: everything left is blocked on the owner.
- Urgency: 1) data safety and money correctness (never parked silently — escalated immediately if stuck) → 2) blockers for other slices → 3) core features → 4) polish.
- Flaky test (passes/fails without code change): quarantined and reported, never retried until green.
- Last ~30 minutes of the usage window: no new large work; finish or park, commit, write handover, and schedule a message to this session to resume when the window resets.

## Asking the owner

1. Open a GitHub issue labelled `needs-decision` (question, options, recommendation).
2. Ask in the Claude Code session, **one question at a time**.
3. Send a push notification when available.
4. Record the answer on the issue and close it.

## Branches, PRs, merging

- One PR per slice from a branch `claude/slice-NN-<name>` off `main`, auto-merge enabled.
- Required checks on `main` (branch protection, set up by the owner): `ci` (types, lint, tests), `coverage`, `mutation` (money core), `review-gate`.
- **`review-gate`**: passes only when the latest commit has a senior approval marker (`<!-- review:senior approve sha=<sha> -->`), plus a security approval marker when risky paths changed, with no later "request changes". A new commit invalidates earlier approvals. (Needed because reviewers act through the owner's account, which cannot approve its own PR.)
- GitHub auto-merge performs the merge; agents never merge directly.
- CI waits are event-driven (PR activity subscription), not polled.

## Environments

| | URL | Database | Updated by |
|---|---|---|---|
| **Staging** | `https://wnulilalbab.github.io/Cc-bill/staging/` | `ccbill-v2-staging` | every merge to `main`, automatically |
| **Production** | `https://wnulilalbab.github.io/Cc-bill/` | `ccbill-v2` | **Release** button only |

- Staging shows a "STAGING" banner; its service worker scope is limited to `/staging/`.
- Staging Playwright runs wait until the deployed build id matches the merged commit, and bypass the service-worker cache.

## Release (owner-triggered workflow)

Precondition: **Ready to release ✓**, set by the Lead only when, for the commit on staging: CI green incl. coverage and mutation thresholds; every test-plan ID has a passing test; full Playwright suite green on staging; every PR approved by senior (and security where required); no open `blocker` issues.

Release workflow steps:
1. Real Claude API test on the synthetic statements (secret `ANTHROPIC_API_KEY_CI`; stops immediately with a clear message if missing).
2. Full Playwright suite on staging.
3. Publish the same build to production; bump version; write release notes.
4. Production smoke test.

Any failure → production unchanged, report to owner.

## Test data

- **100% synthetic.** No real statements, backups or names in any test, CI run, fixture or agent session.
- Fictional household: card A "BCA Keluarga" (Andi, Sari, Bima, Keluarga, Medis); card B "Mandiri Pribadi" (Andi, Rumah, Kantor; PDFs locked with `test1234`).
- Generated by a script in the repo, reproducible byte-for-byte (embedded fonts, fixed timestamps). Each file ships with its expected result (rows, owners, totals).
- Months Jul–Nov 2026 covering: rules and installment start; partial payment and 3 same-day Shopee charges and a refund; Blibli purchase, multi-person payment, hand-recorded payment that never appears; reversal + installment 1/6, paid-right-after-buying, genuine duplicate, never-billed pending charge, interest; payment printed a month later, ±5-day match, overpayment → deposit. Mandiri Aug–Sep as screenshots (backfill), Oct–Nov locked PDFs with refund and Shopee.
- Extras: unbilled screenshots with a payment line; wrong password; table split across pages; empty statement; Oct re-import; Oct copy with one amount off by 1; synthetic old-format backup (~300 transactions, "Unknown" owner, statement payments with assignments).
- Integration tests use recorded AI responses for the synthetic files; only the Release step calls the live API.

## Slice order

0. **Gate the deploy**: `main` deploys to staging only; add the Release workflow skeleton. Merge the current branch through this PR. (Before anything else lands, so no ungated change can reach production.)
1. Fixtures + test harness + minimal CI.
2. Pipeline: coverage gates, mutation testing, `review-gate`, staging specifics, full Release workflow.
3. Money core. 4. New database + migration. 5. Cards, owners, palettes, settings. 6. Import engine. 7. Tagging. 8. Transactions. 9. Payments. 10. Bill + person detail. 11. Share. 12. App shell and look (parallel with 5–11). 13. Insights preview, polish, full scenario run → Ready to release.

Each slice ends merged, deployed to staging, with its test-plan IDs passing.

## Owner one-time setup (checklist delivered when the pipeline exists)

- Branch protection on `main` requiring `ci`, `coverage`, `mutation`, `review-gate`.
- Allow auto-merge.
- Secret `ANTHROPIC_API_KEY_CI` (with a small monthly spend limit on that key).
- GitHub Pages serving the `gh-pages` branch (production root + `/staging/`).

## Out of scope

Human code review, nightly/scheduled automation, real data in tests, more than one reviewer of each kind per PR.
