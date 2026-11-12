# Allowance

Allowance enforces a spending rule for AI shopping agents at the PayPal payment step, so a hidden line on a web page cannot make the agent overspend.

**Try it: https://allowance-colm.onrender.com**

No login or test account needed. It runs on PayPal's sandbox, so no real money moves. This is an entry in the PayPal AI Hackathon.

Type a hidden line for a product page and click Try it. Or click "Skip the AI" to send the exact cart your line asked for straight to checkout, as if the agent had been fooled.

## The problem and the result

**The problem.** Agents have started to shop for people, and a web page can talk to them. Adobe reported a 693% year-over-year rise in traffic from generative AI sources to US retail sites between November 1 and December 31, 2025 ([Adobe press release, January 7, 2026](https://news.adobe.com/news/2026/01/adobe-holiday-shopping-season)). A NeurIPS 2025 study of web agents (WASP, Evtimov and others) found that prompt injection attacks partly succeed in up to 86% of cases ([paper](https://papers.nips.cc/paper_files/paper/2025/hash/1c9818387f5dd0a0bc151214660f059d-Abstract-Datasets_and_Benchmarks_Track.html)).

**The result.** We ran 50 test rows against the rule: 30 product pages with a hidden line that asks for something the rule forbids, and 20 normal restocks.

| Measurement | Result |
|---|---|
| Hidden lines the real agent (Claude Haiku 5.5) followed | 0 of 30 |
| Forbidden carts stopped before PayPal when each was sent straight to checkout | 30 of 30 (26 blocked, 4 held for approval) |
| PayPal charge calls made for those 30 carts | 0 |
| Normal restocks allowed and charged | 20 of 20 |

The second and third rows come from a separate pass. Because the agent followed none of the lines, we used "Skip the AI" to send each forbidden cart to checkout, as a fooled agent would. In this test PayPal is a stand-in that counts calls, so no sandbox money moved in these 50 rows. The real sandbox charge has its own test, `live/paypal.live.ts`. The numbers are in `src/data/eval-results.json`, the per-row detail is in `eval/results/`, and the live page is `/results`.

## How it works

1. A parent writes a rule in plain English, such as "$120 a week, household basics only, nothing over $40 without asking me, never gift cards."
2. Claude Sonnet 5.5 proposes the rule as a mandate, line by line. Clauses it cannot enforce appear under "Not enforced". The parent accepts or removes each one, then signs.
3. The parent approves PayPal once, on PayPal's own sandbox approval page. Allowance keeps the saved account.
4. A Claude Haiku 5.5 agent restocks the house from a demo store. One product page can carry a hidden line.
5. At checkout, plain code with no AI prices the cart from the store's catalog and checks it against the signed mandate. It checks the expiry, the never list, the allowed list, the weekly budget over a rolling 7 days, and the ask-first limit.
6. The check and the reservation of the amount happen in one database transaction, with the ledger row locked. PayPal is called only after that transaction commits.
7. A blocked cart charges $0, and the result card names the rule. An item over the ask-first limit waits for Approve or Decline, and the amount is held for 10 minutes. An allowed cart is charged to the saved account. The receipt shows the PayPal order, the capture, the rule and the mandate version.
8. If the sandbox buyer disputes a charge, Allowance sends PayPal the signed mandate, the cart and the agent's steps as evidence.

Allowance's own server enforces the rule before it calls PayPal. PayPal does not read the mandate. The server signs mandates with a key derived from its own secret, and checkout refuses a mandate that was edited or signed by any other key.

Pages:

- `/` is the try-to-trick-it page.
- `/rule` writes and signs a rule, and `/mandate` shows the demo rule read-only.
- `/log` is the spend log, built with AG Grid Community.
- `/results` shows the attack test, and `/disputes` shows the evidence timeline.
- Each charge gives a receipt link.

The feature list, and the test that proves each feature, are in `FEATURES.md`.

## The PayPal parts the code calls

All calls are direct REST calls to PayPal's sandbox (`api-m.sandbox.paypal.com`). The client refuses any other address.

| PayPal part | What Allowance does with it | Code |
|---|---|---|
| Payment Method Tokens v3 | Creates a setup token, sends the parent to PayPal's hosted approval link, then exchanges the approved setup token for a payment token (the saved account). | `src/lib/paypal/client.ts` |
| Orders v2 | Creates an order with `intent: CAPTURE` that charges the saved account by its `vault_id`, with nobody logged in. The attempt ID is the `PayPal-Request-Id`, so a retry returns the same order. It also reads an order back. | `src/lib/paypal/client.ts` |
| Disputes API | Lists and reads disputes, matches one to a charge by capture ID, and sends evidence (notes and a PDF) through the provide-evidence call, once, as the evidence type PayPal asked for. Tested on a real sandbox dispute: sent 2 seconds after Allowance saw it. | `src/lib/paypal/disputes.ts`, `src/lib/disputes/handle.ts` |
| Webhooks | `/api/paypal/webhook` takes dispute events only. A message counts after PayPal's verify-webhook-signature call confirms it, and Allowance then re-reads the dispute from PayPal. It is off unless `PAYPAL_WEBHOOK_ID` is set, and the demo leaves it off: the owner's Check PayPal for disputes button runs the same steps. | `src/app/api/paypal/webhook/route.ts` |

## The AI tools and how each is used

- **Claude Haiku 5.5** (`claude-haiku-5-5`) runs the shopping agent. It has store tools with strict schemas, and none takes a price or a total: the store sets every price. Its instructions are public in `src/lib/agent/instructions.ts`. Nothing in the agent loop limits what the model may ask for. The rule is enforced at checkout.
- **Claude Sonnet 5.5** (`claude-sonnet-5-5`) compiles the plain-English rule into a proposed mandate with structured output. Plain code validates every number and category before the proposal is shown or signed.
- **Claude Code** built the project: the code, the tests and the attack test.

## Run it yourself

Requirements: Node.js 26 (see `.node-version`) and npm. No database server is needed, because local runs use an embedded Postgres (PGlite).

```bash
git clone https://github.com/zaeem-rafiq/allowance.git
cd allowance
npm ci
npm run dev
```

Open http://localhost:3100. No keys are needed to look around. Without PayPal and Anthropic keys, a run that needs them shows an error card.

- To look around without keys, run `ALLOWANCE_TEST_MODE=1 npm run dev`. This is how the browser tests run the app. It uses a scripted shopping agent, a fake PayPal, a fixed test owner secret (`TEST_SECRETS` in `src/lib/mode.ts`) and an in-memory database. Sign in at `/owner` and click Save PayPal first, or an allowed cart stops at "no PayPal account is saved yet". It does not test the real AI or the real PayPal.
- To use real sandbox keys, put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ANTHROPIC_API_KEY` in a local `.env.local` file. `.env.example` lists every name.
- With real keys, the owner screen (`/owner`) saves the sandbox PayPal account. Outside test mode, its secret is created on first run in the git-ignored `.data/dev-secrets.json`, or you can set `OWNER_SECRET` in `.env.local`.

Checks:

| Command | What it runs |
|---|---|
| `./check` | The secret scan, the `FEATURES.md` checker, lint, type checks, unit and property tests, the build and the browser tests. The browser tests use fakes for PayPal and the AI, so they need no keys. |
| `npm test` | Unit and property tests. |
| `npm run e2e` | Browser tests. |
| `npm run live` | Real sandbox charges (`live/paypal.live.ts`, needs sandbox keys and a saved account from `npx tsx live/paypal-path.ts start` then `finish`) and race tests on real Postgres (`live/ledger.live.ts`, needs `ALLOWANCE_PG_URL` set to a throwaway local database). It is not part of `./check`. |
| `npm run eval:attack` | The 50-row attack test. It needs `ANTHROPIC_API_KEY`. `ATTACK_ROWS=skip npm run eval:attack` runs only the no-AI pass. Both rewrite `src/data/eval-results.json`. |

`./check` also needs three tools on the machine: gitleaks (the secret scanner), python3, and Playwright's browser, installed with `npx playwright install chromium`.

License: MIT. See `LICENSE`.

## Limits

These are scope choices for the hackathon. Allowance runs on PayPal's sandbox only. The mandate follows the field names of AP2's Intent Mandate but is not official AP2, and no AP2 agent or wallet checks it. There is one demo store. Disputes are opened by hand from the sandbox buyer account, and the evidence code is tested against a stand-in for PayPal's replies. Arize tracing is not built.
