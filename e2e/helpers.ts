import type { APIRequestContext, Page } from "@playwright/test";
import { TEST_SECRETS } from "../src/lib/mode";

/** Resets the test server: a fresh database, the fake PayPal's script and counters, the clock and hooks. */
export async function resetApp(request: APIRequestContext, extra: Record<string, unknown> = {}): Promise<void> {
  const res = await request.post("/api/test/control", { data: { reset: true, ...extra } });
  if (!res.ok()) throw new Error(`Test control failed: ${res.status()}`);
}

export async function steer(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await request.post("/api/test/control", { data });
  if (!res.ok()) throw new Error(`Test control failed: ${res.status()}`);
}

export async function paypalCalls(request: APIRequestContext): Promise<{ charge: number; startSave: number; finishSave: number }> {
  const res = await request.get("/api/test/control");
  return (await res.json()).paypalCalls;
}

export async function signInAsOwner(page: Page): Promise<void> {
  await page.goto("/owner");
  await page.getByLabel("Owner secret").fill(TEST_SECRETS.OWNER_SECRET);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Signed in as the owner.").waitFor();
}
