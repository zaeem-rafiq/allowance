---
title: A Render preview is a second server on production's database, so it needs its own environment and production's signing key
date: 2026-11-11
category: best-practices
module: Render previews and mandate signing
problem_type: best_practice
component: infrastructure
severity: high
applies_when:
  - "Checking, fixing or recording on a Render pull-request preview of the allowance service"
  - "Setting, rotating or adding MANDATE_SIGNING_KEY on any server that uses the shared Postgres database"
  - "A preview's /api/health reports paypalKeys, aiKey, signingKey or ownerSecret as false"
symptoms:
  - "A preview's /api/health shows database true while paypalKeys, paypalSaved, aiKey, signingKey and ownerSecret are all false"
  - "Runs on that preview answer that Allowance could not check the rule, and owner sign-in says it is not configured"
tags: [render, preview-environments, mandate-signing-key, shared-database, health-check, environment-variables]
---

# A Render preview is a second server on production's database, so it needs its own environment and production's signing key

## Context

Allowance runs as one Render web service, and every pull request gets a preview of it (`AGENTS.md`, "Where it runs"). The build plan treated a preview as a copy of production. It listed "whether previews copy the base service's environment and database" among the things to confirm before relying on them (`docs/plans/2026-11-11-1503-feat-allowance-demo-milestone-plan.md:424`), and its closing steps say "previews copy production secrets" (`:846`). Its setup steps say to verify the preview with `/api/health` (`:385`). The plan also says preview and production use the same `public` schema (`:192`), and the session that built the app reported that they share one Postgres database.

What was observed on 2026-11-11 for pull request 3's preview, `https://allowance-pr-3.onrender.com`:

- At about 8:24 pm CT (another session's probe) and again at about 9:52 pm CT (this run's probe), `/api/health` returned `{"database":true,"paypalKeys":false,"paypalSaved":false,"aiKey":false,"signingKey":false,"ownerSecret":false}`.
- The session that built the app reported that, of the base service's variables, only `DATABASE_URL` appeared in the preview.
- Not verified in this run: Render's own settings were not read. The production address `https://allowance-colm.onrender.com` answers 404 at `/api/health` because `origin/main` has no health route yet, so the preview could not be compared with a configured base service. The cause of the empty preview environment is unknown. Check again before relying on this.

## Guidance

1. Treat every preview as a second server that runs the branch's code against production's database. It may not start with production's configuration.
2. Open `/api/health` on a new preview before using it. The route prints true or false only (`src/lib/health.ts:19-25`). `database: true` with every other value false means the preview has a database address and none of the keys the check covers.
3. The owner adds the missing variables to the preview in the service's environment settings in Render's dashboard, where the factory rules have the owner enter secrets. Agents never read, copy or log the values, and confirm the result only through `/api/health` turning true.
4. Give the preview exactly production's `MANDATE_SIGNING_KEY`. Do not generate a second random value for it, even though the plan's setup step says "each a long random value" (`:385`). Generate one value, and use it in both places.
5. Once real keys are in previews, every pull-request preview is a public address (the plan calls the preview link "public" and "runs the real keys", `:843`) that holds production's PayPal, Anthropic and signing secrets. The plan's step to turn previews off before the repository goes public (`:846`) then applies, whichever way inheritance turns out to work.

## Why This Matters

A server accepts a mandate only if its own key signed it. `loadVerifiedMandate` throws "mandate signature does not verify" when a mandate's public key differs from the server's expected key (`src/lib/checkout/checkout.ts:98`). It is used by checkout (`:160`) and by approvals (`src/lib/checkout/approvals.ts:61`). The signing module's header note says why: the signature check alone proves the record was not edited, so the caller must also compare the public key with its own (`src/lib/mandate/sign.ts:8-12`).

If preview and production share one database, as the session that built the app reported, they read the same `mandate_versions` rows, so two different keys cause two problems:

- **Demo copies flip back and forth.** `resignDemoCopyIfKeyChanged` inserts a new version signed by the current server's key whenever a ledger's latest mandate is the demo mandate signed by another key (`src/lib/visitor/ledger.ts:73-78`). It runs when the demo ledger is set up and when a run or rule request resolves an existing visitor ledger (`ledger.ts:91`, `:114`; `src/lib/visitor/request.ts:36-37`). With two live keys, each environment re-signs what the other signed last whenever such a request touches that ledger, and every switch adds a version row. The code's comment and its test cover a key that changed once (`src/lib/visitor/ledger.test.ts:44`), not two keys in use at the same time.
- **Visitors' own rules are stranded.** A mandate that is not the demo copy is never re-signed (`ledger.ts:77`). On the server with the other key, that visitor's checkouts and approvals are refused.

A preview with no secrets at all fails differently. In production, `getSecret` reads only the environment (`src/lib/secrets.ts:3`, `:14`, `:35`) and returns null for a missing or short value (`:33-36`). With no signing key, the run route answers 503 with "Allowance could not check your rule, so nothing was charged" (`src/app/api/runs/route.ts:31-32`, `src/lib/checkout/checkout.ts:33`). With no `OWNER_SECRET`, owner sign-in redirects to "not-configured" (`src/app/api/owner/session/route.ts:19`, `src/lib/owner/session.ts:56-58`), so the plan's owner sign-in on the preview (`:388`) cannot happen.

## When to Apply

- Before recording a demo, taking screenshots or asking the owner to sign in on a preview link.
- Whenever `MANDATE_SIGNING_KEY` is created, replaced or copied on any server that shares the database.
- Whenever a preview's health values differ from production's.

## Examples

Reading the health check on a new preview:

```
{"database":true,"paypalKeys":false,"paypalSaved":false,"aiKey":false,"signingKey":false,"ownerSecret":false}
```

- `database` true: the preview reaches a database. Whether it is production's depends on the `DATABASE_URL` it holds.
- `paypalKeys`, `aiKey`, `signingKey`, `ownerSecret` false: add them in the dashboard. After that, all four must read true.
- `paypalSaved` is read from the database (`health.ts:14`), so it turns true on its own once the owner has saved PayPal and the preview reads the same database.

## Related

- `docs/plans/2026-11-11-1503-feat-allowance-demo-milestone-plan.md` still carries the untested assumptions quoted above (`:424`, `:846`) and the risk row "Preview and production share one database and secrets" (`:415`). Correct the plan by hand once the cause is known. This learning does not edit it.
