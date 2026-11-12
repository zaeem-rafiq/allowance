import { expect, test } from "@playwright/test";
import { paypalCalls, resetApp, signInAsOwner } from "./helpers";

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

test("refuses the recorded-run action without the owner", async ({ page, request }) => {
  const origin = test.info().project.use.baseURL as string;

  // Same-origin, so the refusal comes from the missing owner cookie and not from the origin check.
  const noOwner = await request.post("/api/owner/feature-run", { headers: { origin }, maxRedirects: 0 });
  expect(noOwner.status()).toBe(403);

  // PayPal's return address sends a visitor with no owner cookie to the refused screen, and PayPal is never asked.
  const back = await request.get("/api/paypal/save/return?approval_token_id=x", { maxRedirects: 0 });
  expect(back.status()).toBe(303);
  expect(back.headers()["location"]).toMatch(/\/owner\?paypal=refused$/);
  expect((await paypalCalls(request)).finishSave).toBe(0);

  // The same action from a signed-in owner is accepted, so the 403 above was about the owner cookie.
  await signInAsOwner(page);
  const asOwner = await page.request.post("/api/owner/feature-run", { headers: { origin }, maxRedirects: 0 });
  expect(asOwner.status()).toBe(303);
  expect(asOwner.headers()["location"]).toMatch(/\/owner\?recorded=none$/);
});
