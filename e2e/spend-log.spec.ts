import { type Page, expect, test } from "@playwright/test";
import { resetApp, steer } from "./helpers";

const card = (page: Page) => page.getByTestId("result-card");

// Data rows carry a row-index attribute; the header row does not.
const dataRows = (page: Page) => page.locator('[role="row"][row-index]');
const rowWithResult = (page: Page, result: string) =>
  dataRows(page).filter({ has: page.locator('[col-id="result"]', { hasText: new RegExp(`^${result}$`) }) });

test.beforeEach(async ({ request }) => {
  await resetApp(request, { savedPayPal: true });
});

async function skipTheAi(page: Page) {
  await page.getByRole("button", { name: "Skip the AI: send the cart your line asked for" }).click();
  await expect(card(page)).toContainText("Blocked by your rule: never gift cards. PayPal charged $0.");
}

test("lists every attempt with its result and rule", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/");

  // Three runs in one page, so they share one visitor cookie and one ledger.
  await skipTheAi(page);
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  await expect(card(page)).toContainText("Your rule allowed $34, and PayPal charged $34.");
  await steer(request, { paypal: ["refused"] });
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  await expect(card(page)).toContainText("Your rule allowed this. PayPal's sandbox refused it, so nothing was charged.");

  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Spend log" })).toBeVisible();
  await expect(page.getByText("Every checkout your AI tried, allowed or blocked, with the rule that decided it.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the try-it page" })).toHaveAttribute("href", "/");
  await expect(dataRows(page)).toHaveCount(3, { timeout: 60_000 });

  const blocked = rowWithResult(page, "Blocked");
  await expect(blocked).toHaveCount(1);
  await expect(blocked).toContainText("Skip the AI");
  await expect(blocked).toContainText("never gift cards");
  await expect(blocked.locator('[col-id="paypalOrder"]')).toHaveText("—");

  const charged = rowWithResult(page, "Charged");
  await expect(charged).toHaveCount(1);
  await expect(charged).toContainText("Normal restock");
  await expect(charged).toContainText(/\$34\.00/);
  await expect(charged.locator('[col-id="paypalOrder"]')).toContainText(/^FAKE-ORDER-/);

  const refused = rowWithResult(page, "Allowed, not charged");
  await expect(refused).toHaveCount(1);
  await expect(refused).toContainText("Normal restock");
  await expect(refused.locator('[col-id="paypalOrder"]')).toHaveText("—");

  // Newest first: the refused restock, then the charged one, then the blocked trick.
  await expect(page.locator('[role="row"][row-index="0"]')).toContainText("Allowed, not charged");
  await expect(page.locator('[role="row"][row-index="1"]')).toContainText("Charged");
  await expect(page.locator('[role="row"][row-index="2"]')).toContainText("Blocked");

  // Only the charged attempt has a receipt, and the link opens it.
  await expect(page.getByRole("link", { name: "Open receipt" })).toHaveCount(1);
  await charged.getByRole("link", { name: "Open receipt" }).click();
  await expect(page).toHaveURL(/\/receipts\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByRole("heading", { name: "$34 charged" })).toBeVisible();
});

test("shows an empty log to a new visitor", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Visitor A has one attempt in their own log.
  await page.goto("/");
  await skipTheAi(page);
  await page.goto("/log");
  await expect(dataRows(page)).toHaveCount(1, { timeout: 60_000 });

  // Visitor B is a fresh browser context with no cookie. They never see A's attempt.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const visitorB = await other.newPage();
    await visitorB.goto("/log");
    await expect(visitorB.getByRole("heading", { name: "Spend log" })).toBeVisible();
    await expect(visitorB.getByText("No attempts yet.")).toBeVisible();
    await expect(visitorB.getByRole("grid")).toHaveCount(0);
  } finally {
    await other.close();
  }
});
