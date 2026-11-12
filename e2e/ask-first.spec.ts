import { expect, test } from "@playwright/test";
import { openHome, paypalCalls, resetApp } from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await resetApp(request, { savedPayPal: true });
  await openHome(page);
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

test("keeps the run buttons waiting while an approval is open", async ({ page }) => {
  const runButtons = [
    page.getByRole("button", { name: "Try it", exact: true }),
    page.getByRole("button", { name: "Try a normal restock" }),
    page.getByRole("button", { name: "Try a restock with a $52 item" }),
    page.getByRole("button", { name: "Skip the AI: send the cart your line asked for" }),
  ];

  // Wait for the run's response to finish, so the buttons are held by the open approval and not by a run still in flight.
  const streamEnded = page.waitForEvent("requestfinished", (r) => r.url().endsWith("/api/runs"));
  await page.getByRole("button", { name: "Try a restock with a $52 item" }).click();
  const dialog = page.getByRole("dialog", { name: "Approval request" });
  await expect(dialog).toBeVisible();
  await streamEnded;
  await page.waitForTimeout(500);
  for (const button of runButtons) await expect(button).toBeDisabled();

  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByTestId("result-card")).toContainText("You declined. PayPal charged $0.");
  for (const button of runButtons) await expect(button).toBeEnabled();
});
