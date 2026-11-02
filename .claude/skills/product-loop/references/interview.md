# Interview, drill, roast

Ask **one question at a time**. Each question should come with options and a recommended default, so the owner can answer in one word. Write every answer into the draft doc right away.

## Interview: question bank

**People and pain**
- Who uses it, and on what device? Who else sees the result?
- What do you do today instead? Which step is the most painful or the most often wrong?
- Tell me about the last real time this went wrong. If you share a screenshot, crop or blur names, card numbers and addresses first. Never share raw data.

**Shape of the data**
- Where does the data come from (PDF, screenshot, manual entry, another app)? How often does it arrive?
- What does a normal month look like, and what does a messy month look like?
- What existing data must carry over? How was it recorded: which statuses, which fields, which shortcuts? (This feeds the synthetic fixtures. Ask about the shape, never the content, or offer a counts-only script the owner runs.)

**Rules**
- How is money split, rounded and owed? Who decides when it's ambiguous?
- What counts as "done", "paid" or "final"? What can change after that?
- What must **never** happen? Think of lost data, wrong totals, sending private details out, and silent changes.

**Output**
- What does the person on the other end receive (a message, an image, a number)? In what language?
- Where will this be used? One-handed on a phone, offline, under time pressure?

**Done**
- How will you know it works? Name 3 checks you would do yourself on day one.

## Drill

For every rule, push it to a concrete case, then to the edge case:
- *Twice* (a duplicate), *never* (it went missing), *late* (next period), *partial*, *reversed or refunded*, *split between people*, *zero*, *negative*, *huge*.
- "Which screen shows that, and what exactly does it say?"
- Turn each case into a numbered scenario with expected numbers. Those scenarios become the test plan IDs.

## Roast (attack the draft yourself, then present it)

- Contradictions between rules or screens.
- Missing failure paths: wrong password, AI down, bad file, offline, double tap, two tabs open.
- Privacy: what leaves the device? What's in logs, backups and shares?
- Scale: 10× rows, 5 years of history, very long names.
- Migration: what if the old data doesn't fit the new model?
- Scope creep: cut anything nobody asked for.

Present each roast item as: the problem, then options, then your recommendation. The owner picks. Record each decision in the doc, with its date.
