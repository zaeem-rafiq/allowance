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

test("links to every other screen from the first screen", async ({ page }) => {
  await openHome(page);
  const nav = page.getByRole("navigation", { name: "More of Allowance" });
  for (const [name, path] of [
    ["Write your own rule", "/rule"],
    ["Your spend log", "/log"],
    ["Attack test results", "/results"],
    ["The signed demo rule", "/mandate"],
    ["Dispute evidence", "/disputes"],
  ]) {
    await expect(nav.getByRole("link", { name })).toHaveAttribute("href", path);
  }
});
