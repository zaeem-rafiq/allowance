import { expect, test } from "@playwright/test";
import { resetApp } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request, { savedPayPal: true, clock: "2026-12-10T18:00:00Z" });
});

test("still charges a normal restock on December 10", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  await expect(page.getByTestId("result-card")).toContainText("Your rule allowed $34, and PayPal charged $34.");
  await page.getByRole("link", { name: "Open the receipt" }).click();
  await expect(page.getByRole("heading", { name: "$34 charged" })).toBeVisible();
  await expect(page.getByText(/Dec 10, 2026/).first()).toBeVisible();
});
