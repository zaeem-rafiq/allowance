# Features

What Allowance does today, in plain words, and the test that proves each feature. This is the product's contract: change a row in the same pull request as the feature, and `./check` fails when a proof is missing. Planned work belongs in the plan, not here.

Proof names a test file and, after `#`, the name of the test inside it. Every proof names its test; a file alone is not a proof. The first proof is the feature's end-to-end test, and every end-to-end test must be named by some row. Several proofs are separated by commas.

| Feature | What it does | How to reach it | Proof | Broken looks like |
|---|---|---|---|---|
| Home page | Shows the question "Can you trick my AI into spending your money?" | Open the site's address | `e2e/home.spec.ts#shows the question`, `src/app/page.test.tsx#asks the visitor the question` | A blank page, an error page, or the wrong text |
