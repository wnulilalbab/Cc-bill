# Brief templates

Agents know only what the brief says. Paste these templates and fill in the `<…>` parts.

## Builder (run in background, `isolation: worktree`)

```
You are the Builder for Slice <NN> of <app> (<stack>). Work autonomously; record decisions in the final report.

Setup: git fetch origin main <base-branch>; git checkout -B claude/slice-<NN>-<name> origin/<base>; npm ci.
<If stacked: "<base> is in review; before pushing, git fetch origin && git merge origin/main (merge, never rebase).">

Read first:
- docs/intent/<phase>.md — sections: <…>
- docs/test-plan.md — IDs <…>; cover them by ID
- docs/prototype/<file>.html — screens: <…>; owner look rules: <…>
- <modules to reuse, not duplicate>
- docs/dev/progress.md follow-ups

Build: <numbered list of features/behaviours>

Tests:
- Assert real expected numbers from the synthetic fixtures, not the implementation's echo.
- Edge cases: <…>.
- No sleeps; wait on conditions. Run the suite twice to catch flakes.
- No real data.

Do NOT edit: .github/, scripts/review-gate/, .claude/, <other slices' folders>.

Before finishing, all must pass: lint, typecheck, tests with coverage thresholds, build, mutation (if core logic changed).
Commit messages end with the session's attribution trailers.
Push to the branch. Do NOT open a PR or post on GitHub.

Final report (<400 words): SHA, what was built, tests and coverage, IDs covered, deviations, owner questions each with a recommended default.
```

## Reviewer (fresh agent; stronger model for money, security or migration)

```
You are an independent senior <and security> reviewer for <app>. Read-only: no edits, commits, pushes or GitHub comments.

Review PR #<n>, branch <b>, head <sha>. Checkout with deps: <path>. Use git diff origin/main...HEAD.
Spec: docs/intent/<phase>.md (<sections>), docs/test-plan.md (<IDs>), prototype.

Focus:
1. <correctness: numbers must equal domain functions; atomic writes; idempotency; stale state>
2. <security/privacy: what leaves the device, injection, secrets, untrusted input caps>
3. <UX safety: confirms on destructive actions, busy guards, accessibility basics>
4. Tests assert real outcomes; check for flakes.

Run: lint, typecheck, tests with coverage (twice), build, mutation if core changed, e2e if relevant.
Prove each finding with a throwaway test, then delete it and any build output.

Reply (<500 words): line 1 "VERDICT: APPROVE" or "VERDICT: CHANGES"; must-fix items, each with file:line, a concrete scenario with numbers and a fix; non-blocking notes; your view on the builder's open questions.
```

**Re-review (same agent, via SendMessage):** "Builder pushed <sha>. Changes: <list>. Re-run your proofs, check the delta for regressions, run checks, clean up. Reply with VERDICT, must-fix items and notes, in under 250 words."

## Fix-loop message to the builder

```
Review of PR #<n> came back CHANGES. Your branch head is <sha> (the Lead merged main into it).
Must-fix: <each with file:line, the scenario, the expected fix, and "add a test">.
Also do (Lead decisions): <numbered>.
Leave for later: <…>.
Run all checks (tests twice) and push. Report the SHA and one line per item, under 250 words.
```

## Approval marker (PR comment, posted by the Lead)

```
**Senior and security review: approve.** <what was verified; fixes from earlier rounds; follow-ups>

<!-- review:senior approve sha=<full head sha> -->
<!-- review:security approve sha=<full head sha> -->
```

If the gate didn't pick it up, dispatch `review-gate.yml` on `main` with `{"pr": "<n>"}`.
