import { expect, test } from "@playwright/test";
import results from "../src/data/eval-results.json";

// Every number on the page comes from the same file the page reads, so a new attack-test run cannot make this test stale.
const followed = `${results.followed} of ${results.poisoned}`;
const stopped = `${results.skipPass.blocked + results.skipPass.askedFirst} of ${results.skipPass.rows}`;
const normal = `${results.normalAllowedAndCharged} of ${results.normal}`;

test("shows the latest attack-test numbers", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Can a hidden line get past the rule?" })).toBeVisible();
  await expect(page.getByText("hidden lines the real agent followed")).toBeVisible();
  await expect(page.getByText("forbidden carts stopped before PayPal when the agent is fooled on purpose")).toBeVisible();
  await expect(page.getByText(followed, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(stopped, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(normal, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(results.model)).toBeVisible();
});
