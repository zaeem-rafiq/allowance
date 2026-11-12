import { expect, test } from "@playwright/test";
import { paypalCalls, resetApp } from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await resetApp(request, { savedPayPal: true });
  await page.goto("/");
});

test("an item over the limit waits for approval and then charges", async ({ page, request }) => {
  await page.getByRole("button", { name: "Try a restock with a $52 item" }).click();
  const card = page.getByTestId("result-card");
  await expect(card).toContainText("Your AI wants to buy Vacuum filter pack for $52. Your rule says to ask you first.");
  const dialog = page.getByRole("dialog", { name: "Approval request" });
  await expect(dialog).toBeVisible();
  expect((await paypalCalls(request)).charge).toBe(0);

  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(card).toContainText("You approved it. PayPal charged $86.");
  await expect(page.getByRole("link", { name: "Open the receipt" })).toBeVisible();
  expect((await paypalCalls(request)).charge).toBe(1);
});

test("declining charges $0", async ({ page, request }) => {
  await page.getByRole("button", { name: "Try a restock with a $52 item" }).click();
  await page.getByRole("dialog", { name: "Approval request" }).getByRole("button", { name: "Decline" }).click();
  await expect(page.getByTestId("result-card")).toContainText("You declined. PayPal charged $0.");
  expect((await paypalCalls(request)).charge).toBe(0);
});
