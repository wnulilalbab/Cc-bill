# The mockup is the contract

The owner reviews no code, so the mock is the only place they can check the product before it's built. Make it real enough to catch wrong assumptions.

## Build it
- **One self-contained HTML file** in `docs/prototype/`. It has inline CSS and JS, and no build step. Publish it as an artifact so the owner can open it on their phone. Re-publish to the **same URL** after every change.
- Phone-first: 390px wide, real tap targets, and the real fonts and colours. Match the platform the app will run on.
- Use **synthetic data that looks real**: a fictional household with realistic amounts, dates, merchants and messy cases. Never use the owner's data.
- Make the logic real enough to check numbers. Bills should add up, assigning a payment should change the totals, and Draft/Final should flip.

## Scenario mode
Provide a "Scenarios" menu in the mock. Each scenario is a short guided script with its expected result:

```
S3  Overpayment becomes a deposit
1. Open Payments → "30 Oct · Rp 1.500.000"
2. Assign it to Sari's charges (Fill oldest first)
3. Expect: "Left to assign Rp 571.266" → choose "Sari's deposit"
4. Expect: Sari's bill = Rp 0, deposit Rp 571.266
```

- Cover every drill scenario that has a screen.
- Add **free play** so the owner can try their own frame, and a **reset** button.
- Keep a visible version label so the owner knows which version they're looking at.

## Feedback loop
- Turn each owner comment into a change in the mock **and** the requirements doc in the same turn, then re-publish.
- When the owner rejects something twice, offer 2–3 concrete variants side by side instead of guessing again. (CC Bill: the card animation was rejected three times before "a carousel like a banner slider" landed.)
- Write down every look decision (for example "To-pay box lighter than the card", "gear icon for settings", "no native selects") as a numbered rule. Builders and reviewers check against that list.

## Lock
Once the owner says it's final, commit the prototype. From then on, **the prototype and spec win** over any later brief. If a builder or Lead wants to deviate, ask the owner first.
