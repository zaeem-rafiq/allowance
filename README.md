# Allowance

Allowance puts a parent's spending rule into the PayPal payment itself, so one hidden line on a web page cannot trick an AI that shops for you into overspending. It is an entry in the PayPal AI Hackathon.

- Try it (no login): https://allowance-colm.onrender.com
- It runs on PayPal's sandbox only. No real money moves.

## How it works

1. A parent writes a rule in plain English, for example "$120 a week, household basics only, nothing over $40 without asking me, never gift cards." Claude Sonnet turns it into a mandate, and Allowance signs it.
2. The parent saves PayPal once on PayPal's own sandbox approval page (Payment Method Tokens v3).
3. A Claude Haiku agent restocks the house from a demo store. One product page can carry a hidden line.
4. At checkout, plain code checks the cart against the signed mandate before PayPal is charged. An allowed cart becomes an Orders v2 charge on the saved account, with nobody logged in. A blocked cart charges $0.

## Run it locally

Requirements: Node.js 26 and npm. No database server is needed.

```bash
npm ci
npm run dev
```

Open http://localhost:3100. Without PayPal and Anthropic keys the page loads, and a run that needs them shows an error card. Development secrets for signing are created on first use in the git-ignored `.data` folder. To use real sandbox keys, put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ANTHROPIC_API_KEY` in a local `.env.local` file (see `.env.example`).

## Checks

```bash
./check
```

`./check` runs the secret scan, the feature map (`FEATURES.md`), lint, type checks, unit and property tests, the build, and the browser tests. The browser tests use fakes for PayPal and the AI, so they need no keys.

This README is an interim version. The full write-up comes with the submission.
