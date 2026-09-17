---
name: refactor
description: "Extract shared logic and update call sites on this repo, verified by the full test suite. Alias into the `brownfield` skill with intent=refactor pre-selected. Example: extract shared date logic into a util module and update all call sites."
argument-hint: "[what to refactor, in one line]"
---


Refactor job on an existing repository — an alias into `the `brownfield` skill` with the job type
pre-selected. This command takes optional free text; finishing the sentence removes an interview
round-trip, but Gate 0 always fires and always re-confirms scope before anything is written.

Follow the operating manual in
[plugin/skills/brownfield-guide/SKILL.md](/plugin/skills/brownfield-guide/SKILL.md),
with this handover:

- `intent: refactor` — already chosen. Skip step 4a; Gate 0 re-confirms it.
- `seed_description:` — the text of $ARGUMENTS, verbatim, if non-empty.
  Empty means run the normal step-4b interview.
