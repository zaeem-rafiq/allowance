# Allowance: build brief

> **Note added November 11, 2026:** two building blocks changed after approval. The database is Render Postgres on the free plan, because a new Supabase project would cost $10 a month and only a free database was approved. The live address is https://allowance-colm.onrender.com, not allowance.onrender.com. The approved text below is unchanged.

Written Saturday, November 7, 2026, 2:45 pm CT. This brief is your first approval stop: the factory rule says I show you a one-page brief before building anything. I will not build anything until you approve it.

## Decisions for you

Reply "yes to all" to accept every recommendation, or name the number you want to change.

1. **Approve this brief and let me set up the project?** I recommend yes. I set it up the same way `/new-project` does. That gives you:
   - a folder at `~/Documents/Projects/allowance`
   - a private GitHub repository, `zaeem-rafiq/allowance`
   - a free Render web service with preview links
   - a free Supabase database
   - a row in `PROJECTS.md`
2. **May I sign in to sandbox.paypal.com with the test buyer and test seller accounts that PayPal's dashboard creates?** I recommend yes. I need them to approve test payments and to open the test dispute. These are fake sandbox accounts, not your real PayPal.
3. **Approve Render's Starter plan at $7 a month, from Wednesday until results on about December 21?** I recommend yes. It costs about $10 to $14 in total. Without it, Render puts the app to sleep. A judge can then wait up to a minute for the first page.
4. **Approve a $60 cap on Anthropic API credit for the public demo through December 15?** I recommend yes. The credit comes from the $200 of API credit your plan already includes each month. At the cap, the try-it page shows a recorded run instead.
5. **Approve publishing the live link, and making the repository public with an MIT license before submission?** I recommend yes. The hackathon requires a public repository with an open-source license. I do both, and I ask you again before the final submission.
6. **Who speaks in the video?** I recommend you record the two-minute voiceover on Wednesday afternoon from the script. I record the screens on the live site and add captions. If you prefer, I use a synthetic voice. Either way, you watch the final video with sound before I upload it, as your hackathon checklist requires.

## You need to

1. When I send the steps on Saturday evening, spend about 15 minutes in the PayPal developer dashboard. You create a sandbox app and paste its two keys into a local secrets file. I never read or copy the keys.
2. Paste your Anthropic API key and Arize key into the same file, and into Render's settings when I ask.
3. Keep other heavy Claude work light until Thursday. Risk 1 below explains why.

## What and who

Allowance puts your spending rules into the payment itself, so a web page cannot trick an AI that shops for you into overspending. The user is a parent who lets an AI assistant restock the house every week. The parent writes a rule in plain English, such as "$120 a week, household basics only, never gift cards". Allowance turns the rule into a mandate, which is a signed record of the rule that the agent cannot change. The parent approves PayPal once. From then on, the store checks every agent cart against the mandate before PayPal charges anything. If a buyer disputes a purchase, Allowance sends PayPal the mandate, the cart and the agent's steps as evidence.

The mandate follows the shape of AP2. AP2 is Google's open standard for AI agents that pay, and PayPal announced support for it in 2025.

## What a judge sees first

The first screen asks: "Can you trick my AI into spending your money?" A text box holds a hidden line for a product page. The Try it button runs the agent. The big result is either "Blocked by your rule: never gift cards. PayPal charged $0." or a PayPal sandbox order ID with a receipt. The judge can type their own trick, and the judge does not log in.

## Why this beats the obvious builds

Most entrants will build one of these:

- An AI agent that shops and checks out with PayPal. PayPal lists this idea first in its own examples.
- A chat assistant over PayPal's Agent Toolkit. PayPal's toolkit guide builds this kind of app step by step.
- A receipt splitter or invoice helper, from PayPal's example list.

Allowance overlaps the first. Its first screen shows something theirs will not: "We hid a $500 gift-card order on a product page. The agent fell for it. PayPal was never charged."

## First milestone: what you can try

Each line becomes a row in `FEATURES.md` with an end-to-end test. That test clicks through the real app the way a visitor would.

- A visitor types a hidden instruction, runs the agent, and sees "Blocked", the rule that blocked it, and $0 charged.
- A visitor clicks "Try a normal restock" and sees a PayPal sandbox order ID and a receipt that names the allowing rule.
- A parent writes a rule in plain English and sees the signed mandate, line by line.
- A parent saves PayPal once on PayPal's sandbox approval page.
- An item over the ask-first limit shows an approval request. Approving it charges PayPal.
- The spend log, built with AG Grid, lists every attempt with its result, rule and PayPal order.
- When the sandbox buyer opens a dispute, the evidence timeline fills in and PayPal shows the evidence as sent.
- The results page shows the latest attack-test numbers.

## Building blocks

- Next.js and Tailwind, hosted on Render, with Supabase for the database. These are the factory defaults.
- PayPal sandbox, five parts:
  - the Payment Method Tokens v3 API, which saves the parent's PayPal account so the store can charge it later
  - Orders v2, for each charge
  - the Disputes API, for evidence
  - webhooks, so PayPal tells the app about new charges and disputes
  - JavaScript SDK v6, for the parent's approval screen
- PayPal's `@paypal/agent-toolkit` package supplies ready-made dispute and refund tools.
- Claude through the Anthropic API. Sonnet turns the English rule into a mandate. Haiku runs the shopping agent, because a cheaper agent costs less on the public page.
- The rule check itself is plain code, not AI, so the agent cannot argue past it.
- AG Grid Community for the spend log. It is free and MIT-licensed, and it enters the AG Grid sponsor prize.
- Arize tracing on every AI call. Your Arize plan allows 50,000 traced steps a month across all projects, and I cap this project's share.
- Tests check every rule. Property tests also try thousands of generated amounts against the money arithmetic, so a rounding bug cannot slip through.

## Where it runs

After I finish setup, Render hosts the app at `allowance.onrender.com`. Every pull request gets a preview link.

## Hours: 80 in total

The build gets 48 hours, which is 60% of 80. The rest is for testing, the video, the submission and slippage.

| Block | Hours | When (CT) |
|---|---|---|
| Project setup: folder, repository, checks, Render, Supabase | 3 | Sat Nov 7 |
| PayPal sandbox test: charge a saved PayPal account with the buyer away | 2 | Sat Nov 7 |
| Rule writer and rule check, with property tests | 7 | Sun Nov 8 |
| Parent's one-time PayPal approval | 3 | Sun Nov 8 |
| Demo store, poisoned pages and the shopping agent | 9 | Sun Nov 8 to Mon Nov 9 |
| Checkout: rule check, PayPal charge, receipt | 6 | Mon Nov 9 |
| Ask-first approval screen | 2 | Mon Nov 9 |
| Public try-it page, usage caps, tracing | 5 | Mon Nov 9 |
| AG Grid spend log | 3 | Tue Nov 10 |
| Dispute evidence (first to cut) | 6 | Tue Nov 10 |
| Attack test: 40 poisoned pages, 20 normal restocks | 2 | Tue Nov 10 |
| **Build subtotal** | **48** | |
| Code review, security review and fixes | 5 | Tue Nov 10 |
| End-to-end test hardening | 3 | Wed Nov 11 |
| Video: record on the live site, captions, thumbnail | 8 | Wed Nov 11 |
| Submission page, 7 or more captioned screens, README, judge Q&A | 6 | Wed Nov 11 |
| Audits on Tue 12:00 pm and Thu 8:00 am, plus a test where a fresh helper follows the README alone | 3 | Tue and Thu |
| Slippage | 7 | Thu Nov 12 |
| **Total** | **80** | |

Key times, all CT:

- **Sunday, 9:00 pm:** public link up with the blocked-attack example.
- **Monday, 6:00 am:** change cutoff. Your hackathon skill sets this cutoff one third of the way to the deadline. After it, the idea is frozen and the work is polish.
- **Monday, 6:00 pm:** if checkout with receipts is not on the live link, I cut the dispute half.
- **Wednesday, 12:00 pm:** I file a placeholder Devpost entry, after you approve it.
- **Thursday, 11:00 am:** I submit the final entry, after you approve it. The deadline is 2:00 pm CT, which is 12:00 pm PT.

## Cost

| Item | Now | Later |
|---|---|---|
| Render web service | Free plan | Starter at $7 a month, about $10 to $14 in total (decision 3) |
| Supabase | Free plan | Free. A daily automatic ping keeps it from pausing during judging. |
| Anthropic API | From your monthly API credits | Capped at $60 through December 15 (decision 4) |
| PayPal sandbox, AG Grid Community, Arize | Free, or already paid | None |

## Risks

1. **High: usage may run out before Thursday.** Your weekly Claude limit is 55% used, and it resets Friday, November 13, after the deadline. An 80-hour build can use the rest. I will run one build session and keep helper agents on Sonnet and Haiku. Above 70%, your rule allows at most 2 sessions and no review fan-outs. I will follow that rule. I will check usage every morning and tell you if it passes 70%.
2. **High: PayPal may refuse saved PayPal payments in the sandbox.** PayPal must first approve an account to charge a saved PayPal account later. If PayPal refuses, the "nobody logs in" charge fails. The fallback is a weekly hold. The parent approves a $120 PayPal hold, and the agent spends from it. PayPal then releases the rest. The hour-2 test on Saturday decides which path I build.
3. **High: dispute evidence may not work in the sandbox.** Creating disputes by API needs a permission that only a PayPal account manager adds. So I open the test dispute by hand from the sandbox buyer account, and the video says so. If sending evidence still fails at Tuesday noon, I will cut the dispute half.
4. **Medium: the agent may resist the poisoned pages.** If it rarely falls for them, the hook is weaker. I will not weaken the agent on purpose, because a PayPal judge would see a weakened agent as staged. The attack test measures the real rate, and the video shows real cases.
5. **Medium: framing.** Allowance's mandate copies the shape of AP2's mandate but is not official AP2, and it runs at one demo store. The video and page say so. Hiding it would cost points with PayPal engineers.
6. **Low: visitors could use the public page to burn API credits.** Per-visitor and daily caps limit that cost.

## Files

- Win condition: `WIN_CONDITION.md`
- Event facts for `AGENTS.md`: `drafts/AGENTS-hackathon-section.md`
- Demo script and screen list: `docs/demo-script.md`
- PayPal docs for the coding agent: `docs/sponsors/paypal/README.md`

## Numbers in the script

- Adobe: traffic from generative AI sources to US retail sites rose 693.4% year over year, November 1 to December 31, 2025. Source: Adobe press release, January 7, 2026, https://news.adobe.com/news/2026/01/adobe-holiday-shopping-season
- WASP, by Evtimov and others at NeurIPS 2025: prompt injection attacks partially succeed in up to 86% of cases against web agents. Source: https://papers.nips.cc/paper_files/paper/2025/hash/1c9818387f5dd0a0bc151214660f059d-Abstract-Datasets_and_Benchmarks_Track.html
