import { expect, test } from "@playwright/test";
import { DEMO_RULE_TEXT } from "../src/lib/mandate/demo-mandate";
import { resetApp } from "./helpers";

const DEMO_LINES = ["$120 a week", "household basics only", "ask me first over $40", "never gift cards"];

test.beforeEach(async ({ request }) => {
  await resetApp(request, { savedPayPal: true });
});

test("a parent writes a rule and sees the signed mandate", async ({ page }) => {
  await page.goto("/rule");
  await expect(page.getByLabel("Your rule, in plain English")).toHaveValue(DEMO_RULE_TEXT);

  await page.getByRole("button", { name: "Read my rule" }).click();
  const proposed = page.getByTestId("proposed-card");
  await expect(proposed).toBeVisible();
  for (const line of DEMO_LINES) {
    await expect(proposed.getByTestId("rule-lines").getByText(line, { exact: true })).toBeVisible();
  }
  await expect(proposed.getByTestId("household-basics")).toContainText("cleaning, paper goods, laundry and kitchen");
  await expect(proposed.getByTestId("not-enforced")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign this rule" }).click();
  const signed = page.getByTestId("signed-card");
  // A visitor's own ledger starts as a copy of the demo rule (version 1), so their first signed rule is version 2.
  await expect(signed).toContainText("Version 2");
  await expect(signed.getByTestId("mandate-hash")).toHaveText(/^[0-9a-f]{16}…$/);
  await expect(signed.getByTestId("mandate-signature")).toHaveText(/^.{16}…$/);
  await expect(signed.getByTestId("mandate-public-key")).toHaveText(/^.{16}…$/);
  for (const line of DEMO_LINES) {
    await expect(signed.getByTestId("rule-lines").getByText(line, { exact: true })).toBeVisible();
  }

  // The rule is stored for this visitor: a reload shows it as the current rule.
  await page.reload();
  await expect(page.getByTestId("current-card")).toContainText("Version 2");
});

test("lists clauses it cannot enforce", async ({ page }) => {
  await page.goto("/rule");
  // The buttons enable once the page has hydrated. Typing sooner could be overwritten by hydration.
  await expect(page.getByRole("button", { name: "Read my rule" })).toBeEnabled();
  await page.getByLabel("Your rule, in plain English").fill("only on weekdays, $50 a week");
  await page.getByRole("button", { name: "Read my rule" }).click();

  const proposed = page.getByTestId("proposed-card");
  const notEnforced = proposed.getByTestId("not-enforced");
  const sign = page.getByRole("button", { name: "Sign this rule" });
  await expect(proposed.getByTestId("rule-lines")).toContainText("$50 a week");
  await expect(notEnforced).toContainText("only on weekdays");
  await expect(proposed.getByTestId("rule-lines")).not.toContainText("weekdays");
  await expect(sign).toBeDisabled();

  // Remove or Accept unlocks Sign; Undo locks it again.
  await notEnforced.getByRole("button", { name: "Remove" }).click();
  await expect(sign).toBeEnabled();
  await notEnforced.getByRole("button", { name: "Undo" }).click();
  await expect(sign).toBeDisabled();
  await notEnforced.getByRole("button", { name: "Accept" }).click();
  await expect(sign).toBeEnabled();

  await sign.click();
  const signed = page.getByTestId("signed-card");
  await expect(signed).toContainText("Version 2");
  await expect(signed.getByTestId("not-enforced")).toContainText("only on weekdays");

  // Reading the same words again and removing the clause signs a NEW version without it.
  await page.getByRole("button", { name: "Read my rule" }).click();
  await expect(proposed).toBeVisible();
  await proposed.getByTestId("not-enforced").getByRole("button", { name: "Remove" }).click();
  await sign.click();
  await expect(signed).toContainText("Version 3");
  await expect(signed.getByTestId("not-enforced")).toHaveCount(0);
});

test("the public sees the demo mandate read-only", async ({ page, request, baseURL }) => {
  // One visitor signs their own rule, and the public demo rule does not move.
  const origin = { origin: baseURL! };
  const compile = await request.post("/api/rule", {
    headers: origin,
    data: { action: "compile", text: "$30 a week, never toys.", target: "mine" },
  });
  expect(compile.status()).toBe(200);
  const { compiled } = await compile.json();
  const sign = await request.post("/api/rule", {
    headers: origin,
    data: { action: "sign", text: "$30 a week, never toys.", target: "mine", compiled, accepted: [] },
  });
  expect(sign.status()).toBe(200);
  expect((await sign.json()).signed.version).toBe(2);

  // Without the owner's sign-in, the demo parent's rule cannot be changed.
  const refused = await request.post("/api/rule", {
    headers: origin,
    data: { action: "compile", text: DEMO_RULE_TEXT, target: "demo" },
  });
  expect(refused.status()).toBe(403);

  await page.goto("/mandate");
  const card = page.getByTestId("demo-mandate-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("rule-words")).toHaveText(DEMO_RULE_TEXT);
  for (const line of DEMO_LINES) {
    await expect(card.getByTestId("rule-lines").getByText(line, { exact: true })).toBeVisible();
  }
  await expect(card).toContainText("Version 1");
  await expect(card.getByTestId("mandate-hash")).toHaveText(/^[0-9a-f]{16}…$/);
  await expect(card.getByTestId("mandate-signature")).toHaveText(/^.{16}…$/);
  await expect(card.getByTestId("mandate-public-key")).toHaveText(/^.{16}…$/);

  // Read-only: nothing to type into and nothing to sign.
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /sign/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Write your own rule" }).click();
  await expect(page).toHaveURL(/\/rule$/);
});
