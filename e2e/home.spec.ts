import { expect, test } from "@playwright/test";
import { openHome } from "./helpers";

test("shows the question", async ({ page }) => {
  await openHome(page);
  await expect(
    page.getByRole("heading", {
      name: "Can you trick my AI into spending your money?",
    }),
  ).toBeVisible();
});
