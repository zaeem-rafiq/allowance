import { expect, test } from "@playwright/test";
import { resetApp } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("refuses owner screens without the owner secret", async ({ page, request }) => {
  await page.goto("/owner");
  await expect(page.getByRole("button", { name: "Save PayPal" })).toHaveCount(0);

  await page.getByLabel("Owner secret").fill("not-the-secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That secret is not right.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save PayPal" })).toHaveCount(0);

  // Owner actions refuse a request with no owner cookie, and one from another site.
  const noCookie = await request.post("/api/paypal/save/start", { headers: { origin: "http://localhost:3101" } });
  expect(noCookie.status()).toBe(403);
  const otherSite = await request.post("/api/owner/session", {
    headers: { origin: "https://evil.example" },
    form: { secret: "x" },
  });
  expect(otherSite.status()).toBe(403);
});
