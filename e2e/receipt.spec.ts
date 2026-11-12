import { expect, test } from "@playwright/test";
import { resetApp } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request, { savedPayPal: true });
});

test("opens a stored receipt from its link", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a normal restock" }).click();
  const link = page.getByRole("link", { name: "Open the receipt" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/receipts\/[A-Za-z0-9_-]{22}$/);

  // A fresh browser with no cookie opens the same receipt.
  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await other.goto(href!);
  await expect(other.getByRole("heading", { name: "$34 charged" })).toBeVisible();
  await expect(other.getByText("Allowed by your rule: within $120 a week, household basics only.")).toBeVisible();
  await expect(other.getByText(/confirmed by PayPal on/)).toBeVisible();
  await stranger.close();

  await page.goto("/receipts/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
