# Misses

A miss is a bug found after Claude reported the work as done: by the owner in a preview, by a review, by GitHub's check after a local pass, or live. The pull request that fixes a miss adds a regression test and a row here. `/go-live` reports the rows since the last release. A miss that repeats in the same layer becomes a check, a hookify rule, or a rules change.

Layers: unit, property, e2e, review, check, preview walk-through, go-live, live monitoring.

| Date | What broke (owner's words) | Found by | Should have been caught by | What changed |
|---|---|---|---|---|
