# CC Bill — Phase 1 statement of intent

Status: **locked** after interview, prototype review and roast (31 Oct 2026).
Visual and behavioural reference: [`docs/prototype/ccbill-prototype.html`](../prototype/ccbill-prototype.html) (open in a browser; it runs on example data). Where this document and the prototype disagree, this document wins.

## Outcome

On a phone, in **under 5 minutes per statement**, the user imports a card statement, checks the auto-tagged list, assigns the payments the bank reports, reads what each person (budget) has to pay, and shares it on WhatsApp.

## User and context

- One user (Ulil) managing a **shared BCA card** used by several budgets (Ulil, Dhila, Zian, Us/family, Medical) and a **personal Mandiri card** (Ulil, Family, Office reimburse).
- Owners are **budget sources**, not people to split between. Nothing is ever split 50/50 automatically.
- Mental block today: tagging row by row and allocating payments item by item. Phase 1 exists to remove that friction.

## Out of scope (phase 2+)

Spending analysis (Insights tab ships as a preview only), due-date reminders and "paid on time", multi-phone sync, matching Shopee order history, settling money *between* people (e.g. Dhila repaying Ulil after Ulil paid the whole card).

---

## 1. Cards

- A card has: name, bank, last 4 digits, statement day, **palette**, its **own owner list**, a **default owner**, its own tagging rules.
- Owners, rules and defaults are **scoped per card**. An owner created on BCA does not exist on Mandiri.
- Default owner may be "None" → rows with no rule/history get the "check" dot.
- Owners with history cannot be deleted, only **archived** (hidden from tagging/assigning pickers, history kept, restorable).
- Settings → Cards: add/edit card.

## 2. Look and feel

- Light theme only. White/grey base. **Palette comes from the selected card** (accent, background tint, soft tone, deep tone). 8 palettes: Blue, Gold, Lime, Green, Violet, Rose, Orange, Graphite.
- Three looks in Settings. The selected card tile uses the palette's **deep** tone, so the Bill "To pay" box must **never** repeat it:
  - **Clean**: To-pay box in the palette's light soft tint, dark text.
  - **Soft**: white To-pay box with a soft-tint outline, rounder corners.
  - **Bold**: To-pay box in the vivid accent colour (card tile black).
  Palette always applies.
- Font: Plus Jakarta Sans. Bottom nav: Bill · Transactions · (+) Import · Payments · Insights (preview). Settings via gear.
- **No native browser dropdowns.** Every picker is a custom bottom-sheet list.
- App UI language: **English** everywhere. Only the WhatsApp share has a Bahasa/English switch (default Bahasa).
- Card selection on **Bill** is a **carousel (banner slider)**: one row of cards sized like a real credit card (aspect 1.586 : 1, ≈60% of screen width, max 240px — about 234×148 on a 390px phone), the selected card centred and filled with the palette's deep tone, neighbours peeking at the sides (scaled down, faded), page dots below, and a smaller "+ Add card" tile at the end.
  - **Swipe** left/right (touch or mouse drag, >50px) moves to the next/previous card; a small drag snaps back; tapping a peeking card selects it.
  - The **whole row glides** (~420 ms) so the new card ends centred. Only the card row moves; the rest of the screen does not animate. No ripple.
  - Other tabs show a slim **card bar** that opens the card picker (it slides slightly in the direction of the change).
  - Disabled animations when the OS asks for reduced motion.
- Settings icon is a gear (not a sun-like glyph).
- Pop-ups (bottom sheets) are for quick one-tap jobs: owner picker, row edit, duplicates, share, pickers. **Payment assignment is a full-screen page** (§7).

## 3. Statements and Unbilled

- Each card has billed statements (with statement date, due date, printed previous balance, printed new balance) and one **Unbilled** bucket.
- Unbilled is fed by screenshots of the bank app (charges **and** payment lines).
- When a newer statement is imported, matching Unbilled rows (charges and payment lines) **move into it** keeping owner, label, category and payment assignments. Unbilled then holds only rows after the statement date.
- **Backfilling** an older month never touches Unbilled.
- Unbilled rows dated before the latest statement date that were not matched are flagged **"Not on <month> statement"** → user chooses *Delete* or *Keep waiting*. While unresolved they block that statement's Final state.
- Re-importing an existing statement = **Replace**: matching rows keep tags/payments; differences are listed.

## 4. Import

- Pick card → type (Statement / Unbilled screenshots) → file.
- **Password-protected PDFs** (Mandiri) are unlocked on device. "Remember" stores the password **encrypted, on this device only**. Wrong password → clear retry message.
- Statement month comes from the file name, or is picked (backfill). Screenshot statements ask for the bank's printed total.
- "Auto-tag with AI" (default on): **one AI request parses and tags**. Re-run auto-tag available later.
- Before anything is sent to the AI, **name, address and card number are stripped on device**; only transaction lines and totals go out. Responses are cached by file hash + prompt version.
- **Totals check (reconciliation)**: previous balance − payments/credits + charges/fees/interest = printed new balance. Mismatch shows the difference in rupiah; the user can fix/add rows (§6) and the check re-runs.
- **Credit (CR) lines are classified**: *payment*, *refund*, or *reversal*. Only payments go to Payments. Refunds are negative charges for the original owner. Reversals cancel the original purchase.
- **Installment conversion**: `REVERSAL CICILAN … CR` + `CICILAN KE 01 DARI N` → the original purchase (on an earlier statement) is marked *moved to installment* and not counted; the reversal is not counted; payments on the original move to installment 1/N (any excess becomes that owner's deposit); an installment plan is created/linked.
- **Duplicates** (same amount, same day, same merchant) are never skipped silently: "Looks like a duplicate: Keep both / Skip".

## 5. Tagging

- Priority: manual tag → card rule → learned history (same merchant tagged the same way ≥2 times) → AI guess → card default owner.
- Every row gets an owner immediately. Uncertain ones get a yellow **Check** dot. Marketplace merchants (Shopee, Tokopedia, Lazada, TikTok Shop) **always** get Check, and never offer a rule.
- Review happens **in the list**: tap a row → bottom sheet → tap owner. After changing an owner (non-marketplace), toast offers "Always tag X as Y on <card>?" → saves a rule and applies it to matching non-manual rows.
- Settings → Tagging rules (per card) + **Analyze my labels** (suggested rules with evidence "N of M past rows agree"; Accept / Edit / Dismiss / Comment).
- **Fees and interest** go to the **card's default owner**, editable per row.
- Category is an optional field (under "More"), filled by AI, used by Insights in phase 2.

## 6. Transactions

- Rows show: date block, label (or merchant), raw statement line, owner chip, type (Installment n/N, Fee, Reversal, Moved to installment, Refund), tag source (Rule/Auto/AI/You/Card default/Plan) or **Check**, "n of m same day", status (Paid / X left / Unpaid / Refund / Not counted).
- Filters (custom pickers): statement, owner, status (All / Needs check / Unpaid or partly paid / Paid). **Search** by description, label or amount. Summary: Total / Paid / Left to pay.
- Row sheet: owner, label, category, payments covering it (with "after due" marker), **Fix amount, date or description**, **Delete** (confirmation; covering payments return to "To assign").
- **+ Add a missing transaction** to the selected statement.
- Changing the owner of a row that already has a payment asks: **Keep the payment on it** or **Unassign the payment**.

## 7. Payments (core model)

- **Payments come from the bank**: payment lines on statements and in Unbilled screenshots appear automatically under **To assign**. Recording by hand is a fallback.
- A payment is linked to a **date**, never to "the statement it's printed on" (it usually appears on the *next* statement).
- Assigning happens on a **full-screen page**: sticky header (back, source of the payment, live **Left to assign**), scrollable body, sticky footer (assigned total, deposit choice, Save). Back gesture/button leaves without saving.
- Assigning: pick **who it's for** (single person by default; "It was for more than one person" enables several) → tap the **charges it paid**.
  - Charge groups are ordered by **statement date, oldest first**, Unbilled last; groups collapse/expand and show open count + open total.
  - Hidden, with a note saying how many: charges **dated after the payment date**, and charges **already fully paid** by other payments.
  - Tapping a charge assigns its full open amount **capped at what's left of the payment** (partial if not enough). Editable amount for partials; "Pay full" restores.
  - "Fill oldest first" and "Pay all in this statement" both **stop when the payment runs out**.
  - Over-assigning is impossible (Save disabled).
- **Leftover → deposit** (like a top-up) for one chosen owner, or "Decide later" (keeps the bill in Draft). A deposit is **real**: it pays that owner's charges dated on/after the payment date automatically, oldest first; shows as "From <owner>'s deposit" on those charges; unused amount shows as "Deposit waiting".
- Hand-recorded payments: amount + date editable; auto-matched to a statement payment line with the same amount within ±5 days (counted once). If the next statement doesn't show it → **"Not on <month> statement"**: *Keep waiting* / *Paid to another card* (moves it) / *Transfer failed, delete*.
- Bank payments: amount and date read-only.
- Payments tab: **To assign**, **Recorded, not on a statement**, **Done**. Every payment can be reopened and changed.

## 8. Bill

- Per card + statement picker (statements and Unbilled).
- **Draft vs Final**. A statement is Draft while any of these exist; each has a jump link:
  1. rows on that statement with Check,
  2. payments that **block** it: bank payment lines printed on that statement, or hand-recorded payments dated after the previous statement and on/before this due date, that are not fully assigned and not deposited (Unbilled payment lines do **not** block the previous bill),
  3. hand-recorded payments not found on a statement,
  4. (latest statement only) Unbilled rows not on the statement.
- Hero: **"To pay for the <Mon YYYY> bill"** = this statement's open charges + still unpaid from older bills. Lines: charges, already paid, still unpaid from older bills, deposit waiting, installments still to come (not due).
- "As of <today>": paid amounts are **live** (later payments reduce older bills); installments-to-come are a **snapshot as of the selected statement**.
- Card tile shows the total of the **selected** statement (label included).
- By person: a small table per owner (charges, already paid, unpaid from <months>, deposit waiting, installments to come). Tap → owner detail: full lists for this statement, older unpaid grouped per statement, not billed yet (info), installments to come, payments.

## 9. Share

- Image (phone share sheet) or Copy as text. One person or everyone. Bahasa/English.
- Shows statement, due date, **"Per/As of <date>"**, amount per person, optional list of charges (cancelled/reversal rows excluded, refunds marked), older unpaid per month.
- Draft bills are labelled **sementara / provisional**.
- Every share is logged; the share sheet shows **Sent before** with the amount sent and "now X" if it has changed.

## 10. Data, migration, safety

- New IndexedDB database. **Migrate old data** button: preview of every adjustment (all statements → card "BCA Shared"; "Unknown" owner → card default + Check; statement payments keep assignments) → confirm → verification (counts and totals must match exactly). Old database is untouched until **Delete old data** (downloads JSON backup first).
- Testing mode tools: reset new data, re-run migration, load demo data, clear AI cache, inspect record, per-row delete.
- **All test data is synthetic** (see [`dev-loop.md`](dev-loop.md#test-data)). No real statements, backups or names are used in tests, CI or agent sessions.

## Success criteria

1. Every synthetic statement in `test/fixtures/` imports with **totals matching** its printed figures; the corrupted copy reports the exact difference.
2. Migration of the synthetic old-format backup verifies with identical counts and totals; old DB untouched. (The owner's real backup is only ever migrated by the owner, in the app, after release.)
3. The five-minute loop (import → review → assign payments → bill → share) works end to end on a 390px viewport (Playwright).
4. Every rule in this document maps to at least one automated test in `docs/test-plan.md`; coverage gates in CI block deploys.
