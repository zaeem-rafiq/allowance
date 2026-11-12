# Misses

A miss is a bug found after Claude reported the work as done: by the owner in a preview, by a review, by GitHub's check after a local pass, or live. The pull request that fixes a miss adds a regression test and a row here. `/go-live` reports the rows since the last release. A miss that repeats in the same layer becomes a check, a hookify rule, or a rules change.

Layers: unit, property, e2e, review, check, preview walk-through, go-live, live monitoring.

| Date | What broke (owner's words) | Found by | Should have been caught by | What changed |
|---|---|---|---|---|
| 2026-11-11 | "Skip the AI" counted a product twice when a hidden line named it twice, so the cart it sent was bigger than the line asked for. | The attack-test helper agent, reading every row | unit | `forcedCart` counts each product once, at the largest quantity named. Regression test: `src/lib/runs/forced-cart.test.ts#counts a product named twice once`. |
| 2026-11-11 | Per-address caps trusted the first `X-Forwarded-For` entry, which a caller can set, so a client could dodge the caps. | Independent review before the pull request | review | `clientAddress` reads Cloudflare's `CF-Connecting-IP`, then the last forwarded entry. Regression test: `src/lib/limits/limits.test.ts#are stored only as salted hashes that change every hour`. |
| 2026-11-11 | A browser-test fix was committed with a helper's unfinished dispute test swept in by a folder-wide add, so the project's check failed. | The stop hook's `./check` run | check | Commits stage exact file paths, never a whole folder, while helpers work in the same checkout. The dispute feature was finished and given its `FEATURES.md` row. |
