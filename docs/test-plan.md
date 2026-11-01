# CC Bill — Phase 1 test plan

Every requirement in [`docs/intent/phase-1.md`](intent/phase-1.md) maps to at least one case here. Each case ID becomes the name prefix of its automated test (e.g. `it('M-03 …')`), so coverage of this list can be checked mechanically.

## Layers and gates (enforced in CI before deploy)

| Layer | Location | Tool | Gate |
|---|---|---|---|
| Domain logic (pure functions: money, payments, deposits, matching, tagging, reconciliation, installments) | `src/domain/**` | Vitest | **100% lines and branches** |
| Data and migration | `src/data/**` | Vitest + fake-indexeddb | ≥95% lines, ≥90% branches |
| Import, parsing, AI request/response | `src/ai/**`, `src/import/**` | Vitest, recorded AI responses (no live API in CI) | ≥95% lines |
| Screens and components | `src/pages/**`, `src/components/**` | Vitest + Testing Library | ≥80% lines |
| Golden flows | `e2e/**` | Playwright, 390×844 viewport | all pass |
| Types and lint | whole repo | `tsc --noEmit`, ESLint | zero errors |

Additional rules:
- Any PR that drops coverage below a gate fails CI. Gates are configured in `vitest.config.ts` (`coverage.thresholds`, per-glob).
- A test is required for each case ID below; `scripts/check-test-ids.ts` fails CI if an ID in this file has no test.
- Fixtures: **all synthetic** (`test/fixtures/`, generated, committed), per [`intent/dev-loop.md`](intent/dev-loop.md#test-data). No real data anywhere. Names and amounts in the cases below are illustrative; tests use the fictional household and each fixture's expected-result file.

## Money and bill (M)

| ID | Case | Expected |
|---|---|---|
| M-01 | Owner has 1.000.000 on S and 400.000 unpaid on S−1 | Bill(S) = 1.400.000; older listed under S−1 |
| M-02 | Payment dated after due date assigned to S's charges | Bill(S) drops (live); charge shows "after due" |
| M-03 | Installment 1/6, monthly 751.248, viewing S | Installments to come = 5 × 751.248 = 3.756.240 |
| M-04 | Same plan viewed at S+1 | Installments to come = 4 × 751.248 (snapshot per statement) |
| M-05 | Refund −44.631 on S | Owner's S charges reduced by 44.631; row status "Refund" |
| M-06 | Reversal row + original marked moved | Both have effective amount 0; excluded from totals |
| M-07 | Fees and interest without rule | Owner = card default owner; no Check |
| M-08 | Bill for Unbilled selection | Shows unbilled charges + older unpaid billed |
| M-09 | Card tile total | Equals sum of owners' bill for the selected statement |
| M-10 | Hero arithmetic | charges − already paid + older unpaid = total, to the rupiah |
| M-11 | Owner with nothing open | Shows "Paid ✓", not 0 |

## Draft / Final (F)

| ID | Case | Expected |
|---|---|---|
| F-01 | S has 4 Check rows | Draft, item "4 rows need a check" |
| F-02 | Bank payment printed on S, unassigned | Draft, item links to that payment |
| F-03 | Unbilled payment line (after S date), unassigned | Does **not** block S |
| F-04 | Hand-recorded payment between S−1 date and S due, unassigned | Blocks S |
| F-05 | Payment with leftover kept as deposit | Does not block |
| F-06 | Payment with leftover "Decide later" | Blocks |
| F-07 | Hand-recorded payment missing from next statement | Blocks, item "isn't on a statement" |
| F-08 | Unbilled row dated before latest statement, not matched | Blocks latest statement only |
| F-09 | All resolved | Final ✓ |
| F-10 | Fee/interest row with a negative amount (rebate) → Accept | Stored on the row (`signAccepted`); no longer a Draft issue; fixing amount/kind clears it |

## Payments (P)

| ID | Case | Expected |
|---|---|---|
| P-01 | Assign sheet group order | Oldest statement first, Unbilled last |
| P-02 | Charges dated after payment date | Hidden; note counts them |
| P-03 | Charges fully paid by other payments | Hidden; note counts them |
| P-04 | Tap charge with open 1.252.000, payment left 500.000 | Assigned 500.000 (partial) + message |
| P-05 | Tap charge when payment fully assigned | Nothing assigned; message "Untick something first" |
| P-06 | Fill oldest first, payment 500.000 over 5 charges | Fills in date order, stops at 500.000 |
| P-07 | Pay all in this statement | Same cap as P-06, message "ran out after n of m" |
| P-08 | Pay full after a partial | min(open, current + left) |
| P-09 | Over-assign by typing | Save disabled, error shown |
| P-10 | Single-person mode, tap another owner | Switches person, clears previous ticks |
| P-11 | Multi-person mode | Several owners selectable; rows show owner name |
| P-12 | Bank payment | Amount/date read-only |
| P-13 | Hand payment 1.900.000 on 28 Sep, statement line 1.900.000 on 30 Sep | Linked; counted once; assignments unchanged |
| P-14 | Hand payment, line differs by date > 5 days | Not linked; flagged after next statement |
| P-15 | Missing → Keep waiting | Status "Still waiting"; no longer blocks |
| P-16 | Missing → Paid to another card | Moves to other card, owner mapped by name, assignments cleared |
| P-17 | Missing → Transfer failed | Deleted |
| P-18 | Edit an existing (split) payment | Assignments editable and saved |
| P-19 | Payments tab grouping | To assign / Recorded not on statement / Done |

## Deposits (D)

| ID | Case | Expected |
|---|---|---|
| D-01 | Leftover 1.100.000 kept as Dhila's deposit dated 10 Oct; Dhila charge 320.000 on 16 Oct | Charge paid 320.000 "from deposit"; deposit left 780.000 |
| D-02 | Dhila charge dated before deposit date | Not paid by deposit |
| D-03 | Two deposits | Applied in payment-date order |
| D-04 | Explicit assignment added later to a deposit-paid charge | Deposit re-flows; no double payment |
| D-05 | Deposit fully used | Status "used, 0 left"; hero line hidden |

## Import (I)

| ID | Case | Expected |
|---|---|---|
| I-01 | Every synthetic statement (BCA Jul–Nov, Mandiri Oct–Nov PDFs, Aug–Sep screenshots) | Totals match the printed figures in its expected-result file |
| I-02 | One parsed amount off by 1 | Mismatch "Rp 1"; fixing row re-runs check to match |
| I-03 | Mandiri locked PDF, wrong then right password | Clear error, then parse |
| I-04 | Remember password | Stored encrypted; next import asks nothing; Forget clears |
| I-05 | Header stripping | AI payload contains no name, address or full card number |
| I-06 | CR classification | PEMBAYARAN → payment; REVERSAL CICILAN → reversal; REFUND → refund |
| I-07 | Installment conversion with payment on original | Original + reversal not counted; payment moved to 1/N; excess → deposit |
| I-08 | Unbilled merge into newer statement | Charges + payment lines move; tags and assignments kept |
| I-09 | Backfill older month | Unbilled untouched |
| I-10 | Unbilled row not on new statement | Flagged; Delete / Keep waiting work |
| I-11 | Same-day same-amount duplicate in screenshots | Prompt Keep both / Skip; never silent |
| I-12 | Re-import existing statement | Replace; matching rows keep tags/payments; diffs listed |
| I-13 | Screenshot statement for past month | Requires printed total; reconciliation runs |
| I-14 | Month from file name | `CC_eBilling2026-10-11.pdf` → 11 Oct 2026; `22965532_OCT_2026.pdf` → Oct 2026 |
| I-15 | AI cache | Same file + prompt version → no second API call |
| I-16 | AI response schema invalid | Import stops with readable error; nothing saved |

## Tagging (T)

| ID | Case | Expected |
|---|---|---|
| T-01 | Rule "starts with GRAB*" | Owner from rule, source Rule, no Check |
| T-02 | Shopee row with matching rule | Tagged but Check stays |
| T-03 | Merchant tagged same way twice before | Source Auto, no Check |
| T-04 | AI guess low confidence | Check |
| T-05 | No match, card default None | Check |
| T-06 | Owner change → Save rule | Rule saved for that card only; applied to matching non-manual rows |
| T-07 | Marketplace owner change | No rule offered |
| T-08 | Analyze my labels | Suggestions with evidence; Accept adds rule; Dismiss removes |
| T-09 | Rules scoped per card | BCA rule never applies on Mandiri |

## Transactions (X)

| ID | Case | Expected |
|---|---|---|
| X-01 | Search "grab" / "9.000" / label | Filters list; input keeps focus |
| X-02 | Fix amount | Saved; reconciliation re-runs |
| X-03 | Add missing transaction | Added to selected statement, source You |
| X-04 | Delete with payment | Row removed; payment amount back to To assign |
| X-05 | Owner change on paid row → Keep payment | Assignment kept |
| X-06 | Owner change on paid row → Unassign | Assignment removed; charge unpaid |
| X-07 | Same-day badge | "n of m same day" for identical merchant/day |
| X-08 | Status filters | Needs check / Unpaid or partly / Paid |

## Cards and owners (C)

| ID | Case | Expected |
|---|---|---|
| C-01 | Add card | Gets its own Unbilled and owner list; becomes selected |
| C-02 | Palette change | Accent, background, hero tokens update app-wide |
| C-03 | Remove owner without history | Removed |
| C-04 | Owner with history | Only Archive offered; archived hidden from pickers, visible in history |
| C-05 | Default owner None | Unmatched rows get Check |
| C-06 | Look: Clean / Soft / Bold | Tokens change; palette still applied |

## Share (S)

| ID | Case | Expected |
|---|---|---|
| S-01 | One person, Bahasa | Title, due, "Per <date>", total equals Bill screen |
| S-02 | Everyone | One block per owner with charges or older unpaid |
| S-03 | Draft bill | Marked "sementara" / "provisional" |
| S-04 | Reversal/cancelled rows | Excluded from list; refunds labelled |
| S-05 | Share logged | "Sent before" shows amount; "now X" when changed |
| S-06 | Copy as text | Clipboard text matches image content |

## Migration and data (G)

| ID | Case | Expected |
|---|---|---|
| G-01 | Synthetic old-format backup migration | Counts and totals identical to the expected-result file; old DB unchanged |
| G-02 | Preview lists every adjustment; Cancel writes nothing | No new-DB writes |
| G-03 | "Unknown" owner rows | Card default owner + Check |
| G-04 | Delete old data | JSON backup produced first; old DB gone |
| G-05 | Reset new data (testing) | New DB empty; old DB untouched; migration can re-run |
| G-06 | Export/import backup of new DB | Round-trip identical |

## UI rules (U)

| ID | Case | Expected |
|---|---|---|
| U-01 | No native `<select>` anywhere | Lint/test asserts zero `select` elements |
| U-02 | 390px viewport, every tab and sheet | No horizontal scroll |
| U-03 | Card bar on Transactions/Payments/Insights | Opens card picker |
| U-04 | Language | No Indonesian strings in app UI outside share preview |
| U-05 | Card carousel | Selected card centred (±2px); tap peeking card → row glides and new card centred; swipe >50px left/right → next/previous; drag <50px → snaps back, no switch, no click fired; dots follow; screen content does not animate; no horizontal page scroll |
| U-08 | To-pay box vs card | In Clean, Soft and Bold the To-pay box background differs from the selected card tile background |
| U-06 | Reduced motion | No slide animations; card still switches |
| U-07 | Payment assignment | Opens as full-screen page (no overlay); header "Left to assign" updates live while typing; back closes without saving |

## Golden flows (E2E)

| ID | Flow |
|---|---|
| E-01 | Import synthetic BCA Oct → review Check rows → assign the unassigned payment → Bill Final → share one person |
| E-02 | Unbilled screenshots with payment line → assign → next statement import moves both |
| E-03 | Mandiri locked PDF → wrong/right password → refund lowers Ulil's bill |
| E-04 | Migrate synthetic old backup → verify → delete old data |
| E-05 | Hand-recorded payment missing from statement → keep waiting → resolved on next import |
