# Lessons from CC Bill Phase 1

Each lesson here was paid for once. Read them before Stage 2 and before the first release.

## Product and spec
- **The locked spec beats your own brief.** A Lead brief once put the full carousel on every tab. The spec said a slim card bar there. The spec wins, so check briefs against it before sending.
- **Builders defer spec items as "phase 2"** (e.g. share-as-image). Check every reported deviation against the spec. If it's in the spec, send it back.
- **Lead decisions can regress behaviour.** The Lead decided that any disagreeing rule should flag Check. That flagged every GRAB/GRABFOOD exception. Treat your own decisions as reviewable, and add a test that names the real case.

## Test data
- **Synthetic fixtures must match the shape of the real data.** The synthetic old backup recorded payments as explicit allocations. The owner's real data may record them as a "paid" status. After migration, the bill showed about 30m against a 20m limit.
- Before you write fixtures, survey the structure of the real data on the owner's device: field usage, status values, how links were made. Show the results as counts only, not content. Then add a fixture for every shape you find.
- Every reported real-data bug starts as a new synthetic fixture with the same shape, before any fix.

## GitHub and CI
- **Set `main` as the default branch from day one.** `issue_comment` and `workflow_dispatch` workflows run from the default branch. With the wrong default, the review gate never re-ran after approvals.
- Comments posted through an app token may not trigger workflows. Give the gate a `workflow_dispatch` input as a fallback.
- **Mutation gates** have their own traps:
  - A types-only file yields "no tests executed", so skip `types.ts`-style files.
  - Changing `process.env.TZ` at runtime is ignored inside Stryker's runner, so fake the local calendar instead.
  - Large new logic can drop below the threshold. Run mutation locally before opening the PR, and expect each run to take about 15 minutes.
- When a builder simplifies code to kill equivalent mutants, re-check performance. Once a cache was removed and tagging got 19× slower. Keep a spy-based call-count test.
- Verify owner settings through the API (`/rules/branches/main`, the repo's `default_branch`). Don't trust "done": the first ruleset save didn't stick.

## Agents and permissions
- Cloud sessions ignore settings-file bypass modes. The owner must pick **Auto** in the mode menu. Some tools, like PR activity subscribe and unsubscribe, still prompt even in Auto, so poll with read tools instead.
- Run several builders in parallel only when their files don't overlap. Stacked branches merge their base and never rebase. Tell running builders when their base lands.
- Reviewers given the code, not your conclusion, found about 25 real bugs, most of them money or privacy. Examples:
  - phantom deposits
  - double-counted bank lines
  - redaction leaks
  - spoofable totals checks
  - destructive actions without a confirm step
  - backups not awaited before delete

  Never skip review for "small" diffs. Several must-fixes were in two-line changes.

## Money and privacy patterns worth reusing
- Integer currency units only. Signs come from `kind`. Validate every record on every write path, including backup import and migration.
- Cross-check AI-extracted totals against values parsed on the device. Never show "✓ matches" when the printed value wasn't found.
- Redact before sending anything to the AI:
  - Use an allow-list of line shapes.
  - Use a block-list of known names, card digits and address words.
  - Add a test that fails if any AI request contains the holder's name or the card number.
- Destructive flows:
  - two steps, where step 2 is enabled only after step 1 actually succeeded
  - busy guards
  - client-generated ids for idempotent saves
- Use the local date, not UTC, for "today" (UTC+7 users see yesterday before 07:00).

## Release
- Be honest about what isn't proven yet: real documents, the real AI, the owner's phone, human usability.
- Safe first use: migrate, but keep the old data for 1–2 cycles before deleting it.
