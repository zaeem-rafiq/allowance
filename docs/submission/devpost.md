**Try it, no login or test account needed: https://allowance-colm.onrender.com** (PayPal sandbox, no real money)

# Allowance

**Tagline:** Your spending rule, enforced at the PayPal payment step, so a hidden line on a web page cannot make your shopping AI overspend.

## The numbers

- **The problem:** Adobe measured a 693% rise in generative AI traffic to US stores last holiday season. A NeurIPS 2025 study found hidden instructions partly hijack web agents in up to 86% of cases.
- **The result:** The real agent followed 0 of 30 hidden lines. We then sent each of the 30 forbidden carts straight to checkout, as a fooled agent would. All 30 were stopped before PayPal: 26 blocked, 4 held for approval, 0 PayPal charge calls. All 20 normal restocks were charged. PayPal was a stand-in that counts calls.

## Inspiration

A prompt that says "never buy gift cards" sits where an attacker's text can also sit. We put the limit where a web page cannot write: the payment step.

## What it does

A parent writes: "$120 a week, household basics only, nothing over $40 without asking me, never gift cards." Claude proposes a mandate line by line. Allowance signs it once accepted. The parent approves PayPal once, and an AI restocks the house.

Before PayPal is called, plain code checks the cart against the mandate. A forbidden cart charges $0 and names the rule. An item over $40 waits for Approve or Decline. An allowed cart is charged, and the receipt shows the rule. An AG Grid spend log lists every attempt, allowed or blocked. Visitors type their own hidden line and watch. After a dispute, Allowance sends PayPal the mandate, the cart and the agent's steps.

## How we built it

- **PayPal sandbox, direct REST calls:** Payment Method Tokens v3 saves the parent's account through the hosted approval link. Orders v2 charges it with nobody logged in, with the attempt ID as the request ID so a retry cannot charge twice. The Disputes API sends evidence, and a webhook handles dispute events once PayPal confirms the signature.
- **Claude Haiku 5.5** runs the shopping agent. Its store tools have strict schemas, and none takes a price.
- **Claude Sonnet 5.5** compiles the English rule with structured output.
- **Claude Code** built the project.

## Challenges

- **PayPal timeouts.** A timeout can hide a charge, so the amount stays reserved until a repeat with the same request ID settles it.
- **Racing checkouts.** Checkout locks the ledger row and reserves the amount in one transaction. With $40 left, two simultaneous $34 carts let one through.
- **An agent that resisted.** We did not weaken it. "Skip the AI" measures the rule alone.

## Accomplishments

The attack numbers are in `src/data/eval-results.json`. Property tests found a budget bug, now fixed.

## What we learned

The agent resisted every line, but thirty lines and one model are a small sample. We trust the rule.

## Scope choices and what's next

Allowance runs on PayPal's sandbox only. The mandate follows AP2's Intent Mandate field names but is not official AP2. There is one demo store. Disputes are opened by hand from the sandbox buyer, and the evidence code is tested against a stand-in for PayPal's replies. Arize tracing is not built. Next: send evidence on a real sandbox dispute.

## Built with

Next.js, TypeScript, Tailwind CSS, PayPal Payment Method Tokens v3, Orders v2, Disputes API, Webhooks, Claude Haiku 5.5, Claude Sonnet 5.5, Claude Code, AG Grid Community, PostgreSQL, Render

## Try it out

- Live: https://allowance-colm.onrender.com
- Code (MIT): https://github.com/zaeem-rafiq/allowance
