import { expect, test } from "@playwright/test";

test("shows the question", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Can you trick my AI into spending your money?",
    }),
  ).toBeVisible();
});
