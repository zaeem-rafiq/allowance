# Allowance

Allowance checks your spending rules before PayPal charges anything, so a web page cannot trick an AI that shops for you into overspending. It is an entry in the PayPal AI Hackathon.

The owner cannot read or review code. Follow the owner's Global Agent Rules and the factory rules.

## Status

live · Live link: https://allowance-colm.onrender.com · Started: 2026-11-08 · Live since: 2026-11-12

## Win condition

Read `WIN_CONDITION.md` before every scoping decision and every hand-over. The approved brief is `docs/brief.md`, and the demo script is `docs/demo-script.md`. Build from `docs/sponsors/paypal/` when working with PayPal.

## Building blocks

- Next.js and Tailwind, hosted on Render as a web service. Render Postgres (`allowance-db`, free plan, Oregon) for the database, reached only from Render. Local development and the tests use PGlite, an in-process Postgres.
- PayPal sandbox, direct REST calls: Payment Method Tokens v3 (save PayPal once, hosted approval link), Orders v2 (charge the saved account), Disputes API (evidence), and a webhook with signature verification. Not used: JavaScript SDK v6 and `@paypal/agent-toolkit` (the plan records why).
- Claude through the Anthropic API: Haiku 5.5 runs the shopping agent, Sonnet 5.5 compiles the rule. AG Grid Community for the spend log. Arize tracing is not built yet; the `ARIZE_*` settings are read by nothing.

## Commands

- `./check`: runs every check (the secret scan, the feature-map checker, tests, type and lint checks, build). It must pass before any task is done.
- `npm run dev`: starts the app on port 3100. Port 3000 is used by another project on this Mac.
- `npm test`: unit and property tests. `npm run e2e`: browser tests. They start their own test-mode server on port 3101 (fakes for PayPal, the AI and the clock, and an in-memory database).
- `npm run env:check`: prints each setting as set or missing, never a value.
- `npm run live`: the slow PayPal sandbox suite (real sandbox calls). `npx tsx live/paypal-path.ts start|finish` is the two-step saved-PayPal path test.
- `npm run eval:attack`: the attack test, 50 rows with the real Claude Haiku agent against a counting fake PayPal. `ATTACK_ROWS=sample` runs the first 10 poisoned rows. Results go to `eval/results/` and `src/data/eval-results.json`.

## Verification

- `FEATURES.md` is the feature map: what the product does today, in plain words, and the test that proves each feature. Change it in the same pull request as the feature. `./check` runs `scripts/check-features` against it. The checker does not read test files itself: it asks the test runners (Playwright, and Vitest for a unit test a row names) which tests exist, so they must be installed, and a focused test or a file that fails to parse fails the check.
- Tests: unit tests with Vitest; property tests with fast-check wherever the code does arithmetic, parsing, permissions or state changes; one end-to-end test per feature row with Playwright. Slow or live suites: the PayPal sandbox suite and the attack test, named here when they exist.
- Every pull request fills `.github/pull_request_template.md`: the risk tier, how it was tested, the reviews, and how to undo it. `ce-code-review` runs before the pull request is marked ready.
- `docs/misses.md` records every bug found after work was reported done, with the regression test that now catches it.
- The full standard: `~/.claude/rules/verification.md`.

## Where it runs

- Production: Render web service `allowance`, at https://allowance-colm.onrender.com.
- Previews: every pull request gets a Render preview link.

## Authorized workflow

- Work on a task branch and commit verified units.
- You may push task branches and open pull requests without asking. Render preview deployments are authorized, and they are not "going live".
- Merging into `main` deploys to production, so it needs the owner's approval. Use `/go-live` for the project's first launch and for every release after it.
- Secrets live in the service dashboards and in the local `.env.local`. Never read, print, copy, or edit them. List the settings the project needs in `.env.example`.

## Hackathon
This section goes into the project's `AGENTS.md` when the project folder exists. Facts were read from the event's own pages on Saturday, November 7, 2026, at about 2:00 pm CT.

- **Event:** PayPal AI Hackathon, "Build what's next with PayPal and AI" (Devpost, online).
  - Overview: https://paypalaihackathon.devpost.com/
  - Rules: https://paypalaihackathon.devpost.com/rules
  - Resources: https://paypalaihackathon.devpost.com/resources
  - Project gallery: https://paypalaihackathon.devpost.com/project-gallery (not published on November 7)
- **Submission deadline:** Thursday, November 12, 2026, 12:00 pm Pacific Time. That is 2:00 pm Central Time, the owner's time zone. Devpost's header shows "Nov 12, 2026 @ 2:00pm CST".
- **Contest opened:** Thursday, October 1, 2026, 9:15 am PT. Only work started after this counts. This project starts on November 7, 2026.
- **Judging format:** online, from the submission page. Judges may score from the text, images and video alone and are not required to run the project. Judging runs December 1 to 15, 2026. Winners are announced around December 21, 2026.
- **Judging criteria:** paraphrased here. The exact wording is in section 6 of the rules page.
  - Stage One is pass/fail: the project fits the theme and really uses the required PayPal APIs or SDKs.
  - Stage Two has five criteria with equal weight:
    1. Technological Implementation: how thoroughly and skillfully the project uses the PayPal Developer Platform and the AI tools; a working, non-trivial build.
    2. Design: a complete, coherent product experience, not just a technical proof of concept.
    3. Potential Impact: a credible, specific case for solving a real problem for a real audience, and the demo shows the solution doing it.
    4. Innovation/Idea: how creative and new the concept is, and how it differs from existing concepts.
    5. Presentation: the video shows the project working end to end, and the pitch says what problem is solved, for whom and why it matters.
  - Ties go to the higher Technological Implementation score, then to the next criterion in order.
  - The rules allow expert panels, peer review and automated AI-driven analysis.
- **Prizes:**
  - Grand: $12,000, $8,000 and $5,000.
  - Special, $5,000 each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce.
  - Sponsor prizes include AG Grid: $5,000, $2,000 and three of $1,000, for entries that use any AG Grid tool.
  - A project can win one grand or special prize, plus one sponsor prize.
- **Bonuses in the rubric:** none listed. No blog-post or social-post bonus appears on the rules page.
- **Binding rules:**
  - Use the PayPal developer platform in the free sandbox, plus an AI tool, model or platform. PayPal must be central to the project.
  - Functional demo: a hosted URL, or complete setup and run steps in the repository. A mockup or static prototype fails.
  - Public repository on GitHub, GitLab or Bitbucket, with an open-source license file shown in the repository's About section.
  - Text description, plus a list of the AI tools used and how they were used.
  - Demo video under 3 minutes, public on YouTube, showing the project running on its device. No third-party trademarks or copyrighted music without permission.
  - Judges must be able to test it free until judging ends on December 15, 2026. Include any test credentials or sandbox logins in the README.
  - Individuals and teams may enter. More than one entry is allowed if each is substantially different.
  - All materials in English.
- **Midday checks:** at 12:00 pm CT each day until the deadline, recheck the deadline on the event's own page.
  - Final audit on Thursday, November 12, at 8:00 am CT.
- **Change cutoff:** Tuesday, November 10, 2026, 4:30 am CT. This is one third of the way from the owner's approval (Sunday, November 8, 11:44 pm CT) to the deadline. After it, the idea is frozen and the work is polish. A big change after the cutoff needs the owner's yes.
- **Submission target:** final entry submitted by Thursday, November 12, at 11:00 am CT, three hours before the deadline. Keep improving the page and README until 1:30 pm CT.

## Decisions

- 2026-11-07: The owner chose Allowance over Holdback after a skeptic-judge check (23 against 21 of 25).
- 2026-11-08: The owner approved the brief and all six recommendations: project setup, sandbox.paypal.com sign-in with PayPal's generated test accounts, Render Starter from Wednesday until results, a $60 API cap for the public demo through December 15, publishing the live link and making the repository public with an MIT license before submission, and the owner recording the voiceover.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
