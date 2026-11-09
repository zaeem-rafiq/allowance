<!-- Fill every section. The owner reads this instead of the code. Keep the tier in the title too: [low], [medium] or [high]. -->

## What changes for users

<One or two sentences in plain words. Name the FEATURES.md rows added or changed.>

## Risk tier

<low | medium | high>: <why, in one line. Tiers are in ~/.claude/rules/verification.md, section 4.>

## How I tested it

- `./check`: <passed on date>
- New or changed tests: <files, with the property tests named>
- Preview: <which feature rows were exercised, start to finish>
- Not verified: <what, and why>

## Review

- ce-code-review: <N findings: fixed X, dismissed Y>
- /security-review: <ran: N findings | not needed at this tier>
- Dismissed findings and why: <each one, or none>

## How to undo

<Revert this pull request and redeploy, or the exact steps, including any data change.>
Rollback path, high tier only: <the deploy to restore, and for a data change the tested restore or roll-forward>
What could go wrong for users, high tier only: <one line: who is affected, and how, if this change is wrong>

## Misses

<None | the rows added to docs/misses.md>
