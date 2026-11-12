// @vitest-environment node
import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import type { ScriptedCharge } from "@/lib/paypal/fake";
import { checkout, ledgerSpend } from "./checkout";
import { T0, TEST_PUBLIC_KEY, freshCheckoutWorld } from "./test-setup";

const household = CATALOG.filter((p) => ["cleaning", "paper_goods", "laundry", "kitchen"].includes(p.category) && p.priceCents <= 4000);

const cartArb = fc.array(
  fc.record({ productId: fc.constantFrom(...household.map((p) => p.id)), quantity: fc.integer({ min: 1, max: 4 }) }),
  { minLength: 1, maxLength: 3 },
);
const stepArb = fc.record({
  cart: cartArb,
  outcome: fc.constantFrom<ScriptedCharge>("captured", "refused", "unknown"),
  hoursLater: fc.integer({ min: 0, max: 60 }),
});

describe("checkout properties", () => {
  beforeEach(() => vi.stubEnv("ALLOWANCE_TEST_MODE", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("never lets captured plus reserved pass the weekly budget, and every attempt ends in one state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 8 }), async (steps) => {
        const { db, paypal, ledgerId } = await freshCheckoutWorld();
        try {
          let at = T0.getTime();
          for (const step of steps) {
            at += step.hoursLater * 3_600_000;
            paypal.script = [step.outcome];
            await checkout(db, paypal, { attemptId: randomUUID(), ledgerId, runId: null, source: "skip", cart: step.cart, expectedPublicKey: TEST_PUBLIC_KEY }, new Date(at));
            const { spentCents, pendingCents } = await ledgerSpend(db, ledgerId, new Date(at));
            expect(spentCents + pendingCents).toBeLessThanOrEqual(12000);
          }
          const rows = await db.query<{ state: string; reserved_cents: number; captured_cents: number }>(
            "SELECT state, reserved_cents, captured_cents FROM attempts",
          );
          for (const r of rows) {
            expect(["blocked", "stopped", "captured", "allowed_not_charged", "unknown"]).toContain(r.state);
            // A reservation is held only while PayPal's answer is unknown, and released exactly once.
            if (r.state === "unknown") expect(r.reserved_cents).toBeGreaterThan(0);
            else expect(r.reserved_cents).toBe(0);
            if (r.state !== "captured") expect(r.captured_cents).toBe(0);
          }
        } finally {
          await db.close();
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
