// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import type { FakePayPal } from "@/lib/paypal/fake";
import { CANNOT_CHECK, checkout, findAttemptByReceipt, ledgerSpend } from "./checkout";
import { LIST_CART, T0, TEST_PUBLIC_KEY, freshCheckoutWorld } from "./test-setup";

const GIFT = [...LIST_CART, { productId: "gift-card-500", quantity: 1 }];

describe("checkout", () => {
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

  const go = (cart: unknown, extra: Partial<{ attemptId: string; runId: string | null; at: Date }> = {}) =>
    checkout(
      db,
      paypal,
      { attemptId: extra.attemptId ?? randomUUID(), ledgerId, runId: extra.runId ?? null, source: "skip", cart, expectedPublicKey: TEST_PUBLIC_KEY },
      extra.at ?? T0,
    );

  it("captures an allowed cart, stores the payment, adds to spend and issues a receipt", async () => {
    const r = await go(LIST_CART);
    expect(r.attempt?.state).toBe("captured");
    expect(r.attempt?.captured_cents).toBe(3400);
    expect(r.attempt?.paypal?.orderId).toMatch(/^FAKE-ORDER-/);
    expect(r.attempt?.receipt_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await ledgerSpend(db, ledgerId, T0)).spentCents).toBe(3400);
    expect(r.message).toBe("Your rule allowed $34, and PayPal charged $34.");
  });

  it("blocks a gift card with the rule cited, leaves the ledger unchanged, and never calls PayPal", async () => {
    const r = await go(GIFT);
    expect(r.attempt?.state).toBe("blocked");
    expect(r.attempt?.rule).toBe("never gift cards");
    expect(r.message).toBe("Blocked by your rule: never gift cards. PayPal charged $0.");
    expect(paypal.calls.charge).toBe(0);
    expect(await ledgerSpend(db, ledgerId, T0)).toEqual({ spentCents: 0, pendingCents: 0 });
  });

  it("releases the reservation when PayPal refuses, and logs allowed, not charged", async () => {
    paypal.script = ["refused"];
    const r = await go(LIST_CART);
    expect(r.attempt?.state).toBe("allowed_not_charged");
    expect(r.message).toBe("Your rule allowed this. PayPal's sandbox refused it, so nothing was charged.");
    expect(await ledgerSpend(db, ledgerId, T0)).toEqual({ spentCents: 0, pendingCents: 0 });
  });

  it("keeps the reservation when PayPal times out twice, and never reports $0", async () => {
    paypal.script = ["unknown"];
    const r = await go(LIST_CART);
    expect(r.attempt?.state).toBe("unknown");
    expect(r.message).toBe("Checking with PayPal");
    expect(r.message).not.toContain("$0");
    expect((await ledgerSpend(db, ledgerId, T0)).pendingCents).toBe(3400);
  });

  it("settles an unknown attempt on a later read, to captured or to allowed, not charged", async () => {
    paypal.script = ["unknown", "captured"];
    const id = randomUUID();
    expect((await go(LIST_CART, { attemptId: id })).attempt?.state).toBe("unknown");
    const later = await go(LIST_CART, { attemptId: id });
    expect(later.attempt?.state).toBe("captured");
    expect(await ledgerSpend(db, ledgerId, T0)).toEqual({ spentCents: 3400, pendingCents: 0 });

    paypal.script = ["unknown", "refused"];
    const id2 = randomUUID();
    await go(LIST_CART, { attemptId: id2 });
    expect((await go(LIST_CART, { attemptId: id2 })).attempt?.state).toBe("allowed_not_charged");
  });

  it("makes one PayPal call for the same attempt sent twice", async () => {
    const id = randomUUID();
    const a = await go(LIST_CART, { attemptId: id });
    const b = await go(LIST_CART, { attemptId: id });
    expect(paypal.calls.charge).toBe(1);
    expect(b.attempt?.receipt_id).toBe(a.attempt?.receipt_id);
  });

  it("lets only one of two concurrent $34 checkouts through when $40 is left", async () => {
    // $80 spent earlier this week leaves $40.
    await go([{ productId: "laundry-detergent", quantity: 5 }, { productId: "dish-soap", quantity: 5 }]);
    const [a, b] = await Promise.all([go(LIST_CART), go(LIST_CART)]);
    const states = [a.attempt?.state, b.attempt?.state].sort();
    expect(states).toEqual(["blocked", "captured"]);
    const blocked = [a, b].find((r) => r.attempt?.state === "blocked");
    expect(blocked?.attempt?.rule).toBe("$120 a week");
  });

  it("charges nothing when the ledger cannot be read", async () => {
    const r = await checkout(db, paypal, { attemptId: randomUUID(), ledgerId: "no-such-ledger", runId: null, source: "skip", cart: LIST_CART, expectedPublicKey: TEST_PUBLIC_KEY }, T0);
    expect(r.error).toBe("cannot_check");
    expect(r.message).toBe(CANNOT_CHECK);
    expect(paypal.calls.charge).toBe(0);
  });

  it("charges nothing when the mandate row was changed after signing", async () => {
    await db.query(
      "UPDATE mandate_versions SET mandate = jsonb_set(mandate, '{allowance_rules,weekly_budget_cents}', '99999') WHERE ledger_id = $1",
      [ledgerId],
    );
    const r = await go(LIST_CART);
    expect(r.error).toBe("cannot_check");
    expect(r.message).toBe(CANNOT_CHECK);
    expect(paypal.calls.charge).toBe(0);
  });

  it("charges nothing when the mandate was signed by a key other than the server's", async () => {
    const r = await checkout(
      db,
      paypal,
      { attemptId: randomUUID(), ledgerId, runId: null, source: "skip", cart: LIST_CART, expectedPublicKey: "other-key" },
      T0,
    );
    expect(r.error).toBe("cannot_check");
    expect(paypal.calls.charge).toBe(0);
  });

  it("refuses a second checkout in one run", async () => {
    const runId = randomUUID();
    await db.query("INSERT INTO runs (id, ledger_id, kind, status, created_at) VALUES ($1, $2, 'agent', 'running', $3)", [
      runId,
      ledgerId,
      T0.toISOString(),
    ]);
    await go(GIFT, { runId });
    const second = await go(LIST_CART, { runId });
    expect(second.error).toBe("already_checked_out");
    expect(paypal.calls.charge).toBe(0);
  });

  it("allows but does not charge when no PayPal account is saved", async () => {
    await db.query("DELETE FROM settings");
    const r = await go(LIST_CART);
    expect(r.attempt?.state).toBe("allowed_not_charged");
    expect(r.message).toBe("Your rule allowed this, but no PayPal account is saved yet, so nothing was charged.");
  });

  it("holds a $52 item for the parent's approval and charges nothing yet", async () => {
    const r = await go([{ productId: "vacuum-filters", quantity: 1 }]);
    expect(r.attempt?.state).toBe("pending");
    expect(r.message).toContain("asking you first");
    expect(paypal.calls.charge).toBe(0);
    expect((await ledgerSpend(db, ledgerId, T0)).pendingCents).toBe(5200);
  });

  it("returns nothing for an unknown receipt ID", async () => {
    expect(await findAttemptByReceipt(db, "AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(await findAttemptByReceipt(db, "../etc")).toBeNull();
  });
});
