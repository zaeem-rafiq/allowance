import { type Page, expect, test } from "@playwright/test";
import { openHome, paypalCalls, resetApp, steer } from "./helpers";

// Data rows carry a row-index attribute; the header row does not.
const dataRows = (page: Page) => page.locator('[role="row"][row-index]');

test.afterEach(async ({ request }) => {
  // Later specs that never reset the app must not run on a frozen clock.
  await steer(request, { clock: null });
});

test("settles a charge PayPal left unknown when the visitor opens the spend log", async ({ page, request }) => {
  test.setTimeout(120_000);
  // The clock is set before the run, so the charge is created at 03:00:00 and the log is read 45 seconds later.
  await resetApp(request, { savedPayPal: true, clock: "2026-11-12T03:00:00Z" });
  await steer(request, { paypal: ["unknown"] });

  await openHome(page);
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  const card = page.getByTestId("result-card");
  await expect(card).toContainText("Checking with PayPal");
  await expect(card).not.toContainText("PayPal charged");
  expect((await paypalCalls(request)).charge).toBe(1);

  // 45 seconds later, more than the 30 an unknown charge waits, PayPal answers the repeat with the capture.
  await steer(request, { clock: "2026-11-12T03:00:45Z", paypal: ["captured"] });
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Spend log" })).toBeVisible();
  await expect(dataRows(page)).toHaveCount(1, { timeout: 60_000 });

  const row = dataRows(page).first();
  await expect(row.locator('[col-id="result"]')).toHaveText("Charged");
  await expect(row.locator('[col-id="paypalOrder"]')).toContainText(/^FAKE-ORDER-/);
  await expect(row).toContainText(/\$34\.00/);
  await expect(row.getByRole("link", { name: "Open receipt" })).toBeVisible();
  // One call for the run and one repeat for the settlement.
  expect((await paypalCalls(request)).charge).toBe(2);
});
