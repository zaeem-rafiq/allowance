# PayPal AI Hackathon: win condition

Written on November 7, 2026, before any build decision. Re-read it before every scoping decision and before every hand-over.

## Who scores this and how

Paraphrased from the official rules. The exact text is at https://paypalaihackathon.devpost.com/rules.

- Stage One is pass/fail. The project must fit the theme and really use PayPal (sandbox) and AI.
- Stage Two scores five criteria with equal weight:
  1. Technological Implementation: how deeply and well the project uses PayPal and the AI tool, and whether it works.
  2. Design: a complete product, not only a technical proof.
  3. Potential Impact: a specific, believable problem for a real audience, solved in what the demo shows.
  4. Innovation/Idea: new, and different from products that already exist.
  5. Presentation: the video shows it working from start to finish, and says who it is for and why it matters.
- Ties go to the higher Technological Implementation score.
- The judges are PayPal staff: three developer advocates, a software engineer, an engineering manager and a senior product manager. Sponsor staff judge the sponsor prizes.
- The rules allow expert panels, peer review and automated AI analysis.
- Judges may score from the text, images and video alone. They do not have to run the project or watch past 3 minutes.
- The field has 30,418 registrants (counted November 7, 2026).
- The deadline is Thursday, November 12, 2026, at 12:00 pm PT.

## What winning looks like

In the first 30 seconds of the video, a PayPal judge sees an AI agent catch a real problem and move sandbox money through more than one PayPal product to fix it. The judge can then try it from a public link with their own input and no login.

## How this fails

1. **Looks small.** One flow on one PayPal API reads as a weekend tutorial next to thousands of entries.
2. **Crowd collision.** The idea is one of PayPal's own example ideas, so hundreds of near-copies compete with it.
3. **Depth invisible.** Holds, saved payments and webhooks happen off screen, and the video shows only a chat box and a green check.
4. **Production gap.** A PayPal engineer sees that the money flow could not work for real. Examples: a saved PayPal payment works only for the merchant that saved it, a payment hold lasts 29 days at most, and fees on large amounts are high.
5. **Cannot be tried, or late.** The judge needs sandbox logins, or the solo build uses up the day the video needs.

## Decisions

- **November 7, 2026:** the owner chose Allowance, spending rules for AI agents enforced at the PayPal payment, with dispute evidence. A skeptic-judge helper had scored it 23 of 25, against 21 for Holdback. The build brief is in `docs/brief.md`.
