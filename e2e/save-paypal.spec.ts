import { expect, test } from "@playwright/test";
import { paypalCalls, resetApp, signInAsOwner } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("the owner saves PayPal once", async ({ page, request }) => {
  await signInAsOwner(page);
  await expect(page.getByText("PayPal is not saved yet.")).toBeVisible();

  await page.getByRole("button", { name: "Save PayPal" }).click();
  // The fake PayPal's approval page sends the browser straight back.
  await expect(page.getByText("PayPal saved. The store can now charge it within your rule.")).toBeVisible();
  await expect(page.getByText("PayPal saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace saved PayPal" })).toBeVisible();

  const calls = await paypalCalls(request);
  expect(calls.startSave).toBe(1);
  expect(calls.finishSave).toBe(1);
  // The saved token reference never reaches the page.
  expect(await page.content()).not.toContain("FAKE-VAULT");
});
