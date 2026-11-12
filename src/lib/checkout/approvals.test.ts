// @vitest-environment node
import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import type { FakePayPal } from "@/lib/paypal/fake";
import { TEST_SECRETS } from "@/lib/mode";
import { getOrCreateVisitorLedger } from "@/lib/visitor/ledger";
import { decideApproval } from "./approvals";
import { checkout, ledgerSpend } from "./checkout";
import { LIST_CART, T0, TEST_PUBLIC_KEY, freshCheckoutWorld } from "./test-setup";

const FILTERS = [{ productId: "vacuum-filters", quantity: 1 }];
const MIN = 60_000;

describe("ask-first approvals", () => {
  let db: Db;
  let paypal: FakePayPal;
  let ledgerId: string;

  beforeEach(async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    ({ db, paypal, ledgerId } = await freshCheckoutWorld());
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  const ask = async (cart: unknown = FILTERS, at = T0) =>
    (await checkout(db, paypal, { attemptId: randomUUID(), ledgerId, runId: null, source: "restock", cart, expectedPublicKey: TEST_PUBLIC_KEY }, at)).attempt!;
  const decide = (attemptId: string, decision: "approve" | "decline", at = T0, who = ledgerId) =>
    decideApproval(db, paypal, { attemptId, ledgerId: who, decision, expectedPublicKey: TEST_PUBLIC_KEY }, at);

  it("charges once the parent approves", async () => {
    const a = await ask();
    expect(a.state).toBe("pending");
    const r = await decide(a.id, "approve", new Date(T0.getTime() + MIN));
    expect(r.attempt?.state).toBe("captured");
    expect(r.attempt?.captured_cents).toBe(5200);
    expect(paypal.calls.charge).toBe(1);
  });

  it("charges $0 and releases the amount when the parent declines", async () => {
    const a = await ask();
    const r = await decide(a.id, "decline");
    expect(r.attempt?.state).toBe("declined");
    expect(paypal.calls.charge).toBe(0);
    expect(await ledgerSpend(db, ledgerId, T0)).toEqual({ spentCents: 0, pendingCents: 0 });
  });

  it("blocks an approval at $0 when another charge used the budget in the meantime", async () => {
    // $102 spent leaves $18, and the held $52 counted against it already.
    const a = await ask();
    await db.query("UPDATE attempts SET reserved_cents = 0, state = 'declined' WHERE id = $1", [a.id]);
    for (let i = 0; i < 3; i++) await ask(LIST_CART);
    await db.query("UPDATE attempts SET state = 'pending', reserved_cents = 5200 WHERE id = $1", [a.id]);
    const r = await decide(a.id, "approve");
    expect(r.attempt?.state).toBe("blocked");
    expect(r.attempt?.rule).toBe("$120 a week");
    expect(paypal.calls.charge).toBe(3);
  });

  it("makes one charge from two Approve taps", async () => {
    const a = await ask();
    const [x, y] = await Promise.all([decide(a.id, "approve"), decide(a.id, "approve")]);
    expect(paypal.calls.charge).toBe(1);
    expect(x.attempt?.receipt_id ?? y.attempt?.receipt_id).toBeTruthy();
  });

  it("expires after 10 minutes and releases the amount", async () => {
    const a = await ask();
    const later = new Date(T0.getTime() + 10 * MIN);
    expect((await ledgerSpend(db, ledgerId, later)).pendingCents).toBe(0);
    const r = await decide(a.id, "approve", later);
    expect(r.attempt?.state).toBe("expired");
    expect(paypal.calls.charge).toBe(0);
  });

  it("counts a pending amount against a second run's budget", async () => {
    await ask(); // $52 held
    await ask(LIST_CART); // $34 charged, $86 used
    // $36 more fits without the hold ($70) but passes $120 with it ($122).
    const third = await ask([{ productId: "laundry-detergent", quantity: 3 }]);
    expect(third.state).toBe("blocked");
    expect(third.rule).toBe("$120 a week");
  });

  it("finds nothing to approve with another visitor's ledger", async () => {
    const a = await ask();
    const other = await getOrCreateVisitorLedger(db, undefined, TEST_SECRETS.MANDATE_SIGNING_KEY, T0);
    const r = await decide(a.id, "approve", T0, other.ledgerId);
    expect(r.error).toBe("not_found");
    expect(paypal.calls.charge).toBe(0);
  });

  it("keeps captured plus held amounts within the weekly budget with approve, decline and expiry", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            cart: fc.constantFrom<unknown>(FILTERS, LIST_CART, [{ productId: "dish-soap", quantity: 3 }]),
            decision: fc.constantFrom<"approve" | "decline" | "wait">("approve", "decline", "wait"),
            minutesLater: fc.integer({ min: 0, max: 20 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (steps) => {
          const world = await freshCheckoutWorld();
          try {
            let at = T0.getTime();
            for (const step of steps) {
              at += step.minutesLater * MIN;
              const r = await checkout(
                world.db,
                world.paypal,
                { attemptId: randomUUID(), ledgerId: world.ledgerId, runId: null, source: "restock", cart: step.cart, expectedPublicKey: TEST_PUBLIC_KEY },
                new Date(at),
              );
              if (r.attempt?.state === "pending" && step.decision !== "wait") {
                await decideApproval(
                  world.db,
                  world.paypal,
                  { attemptId: r.attempt.id, ledgerId: world.ledgerId, decision: step.decision, expectedPublicKey: TEST_PUBLIC_KEY },
                  new Date(at + MIN),
                );
              }
              const { spentCents, pendingCents } = await ledgerSpend(world.db, world.ledgerId, new Date(at + MIN));
              expect(spentCents + pendingCents).toBeLessThanOrEqual(12000);
            }
          } finally {
            await world.db.close();
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
