import { expect, test } from "@playwright/test";
import { openHome, resetApp, signInAsOwner } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request, { savedPayPal: true });
});

test("shows the recorded run at the cap", async ({ page }) => {
  // One real (scripted) run, marked by the owner as the recorded run.
  await openHome(page);
  await page.getByRole("button", { name: "Try it" }).click();
  await expect(page.getByTestId("result-card")).toContainText("Your AI fell for it.");
  await signInAsOwner(page);
  await page.getByRole("button", { name: "Use my latest run as the recorded run" }).click();
  await expect(page.getByText("Your latest run in this browser is now the recorded run.")).toBeVisible();

  // Four more AI runs use up the visitor's five an hour.
  await openHome(page);
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Try a normal restock" }).click();
    await expect(page.getByTestId("result-card")).toBeVisible();
  }
  await page.getByRole("button", { name: "Try it" }).click();
  await expect(page.getByText("You have used this hour\u2019s live AI tries.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Recorded on / })).toBeVisible();
  await expect(page.getByLabel("Recorded run").getByTestId("result-card")).toContainText("Your AI fell for it.");

  // Skip the AI still works at the cap.
  await page.getByRole("button", { name: "Skip the AI: send the cart your line asked for" }).click();
  await expect(page.getByTestId("result-card").first()).toContainText("Blocked by your rule: never gift cards. PayPal charged $0.");
});
