import { expect, test } from "@playwright/test";

test("shows the latest attack-test numbers", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Can a hidden line get past the rule?" })).toBeVisible();
  await expect(page.getByText("hidden lines the real agent followed")).toBeVisible();
  await expect(page.getByText("forbidden carts stopped before PayPal when the agent is fooled on purpose")).toBeVisible();
  await expect(page.getByText("30 of 30").first()).toBeVisible();
  await expect(page.getByText("0 of 30", { exact: true })).toBeVisible();
  await expect(page.getByText("20 of 20").first()).toBeVisible();
  await expect(page.getByText("claude-haiku-5-5")).toBeVisible();
});
