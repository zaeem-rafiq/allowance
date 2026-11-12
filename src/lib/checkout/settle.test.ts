// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { TEST_SECRETS } from "@/lib/mode";
import type { FakePayPal } from "@/lib/paypal/fake";
import type { PayPalPort } from "@/lib/paypal/port";
import { getOrCreateVisitorLedger } from "@/lib/visitor/ledger";
import { decideApproval } from "./approvals";
import {
  APPROVED_RULE,
  type AttemptRow,
  RESTOCK_DESCRIPTION,
  SETTLE_REPEAT_WINDOW_MS,
  SETTLE_RESERVED_AFTER_MS,
  SETTLE_UNKNOWN_AFTER_MS,
  chargeDescription,
  checkout,
  ledgerSpend,
  settleOpenAttempts,
} from "./checkout";
import { LIST_CART, T0, TEST_PUBLIC_KEY, freshCheckoutWorld } from "./test-setup";

const SPONGE = [{ productId: "sponges", quantity: 1 }];

describe("settling open attempts on the visitor's next read", () => {
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

  const after = (ms: number) => new Date(T0.getTime() + ms);
  const go = (cart: unknown = LIST_CART, attemptId = randomUUID(), at = T0, ledger = ledgerId) =>
    checkout(db, paypal, { attemptId, ledgerId: ledger, runId: null, source: "restock", cart, expectedPublicKey: TEST_PUBLIC_KEY }, at);
  const row = async (id: string) => (await db.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1", [id]))[0];
  /** The same fake seen through the port, so a spy can read the description the fake's own signature leaves out. */
  const spyOnCharge = () => vi.spyOn(paypal as PayPalPort, "charge");
  /** An attempt whose first PayPal call came back unknown. */
  const unknownAttempt = async (cart: unknown = LIST_CART) => {
    const id = randomUUID();
    const r = await go(cart, id);
    expect(r.attempt?.state).toBe("unknown");
    return id;
  };

  it("leaves an unknown attempt alone until it is older than 30 seconds", async () => {
    paypal.script = ["unknown"];
    const id = await unknownAttempt();
    expect(paypal.calls.charge).toBe(1);

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_UNKNOWN_AFTER_MS - 1))).toBe(0);
    // Exactly 30 seconds is not older than 30 seconds.
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_UNKNOWN_AFTER_MS))).toBe(0);
    expect(paypal.calls.charge).toBe(1);
    expect((await row(id)).state).toBe("unknown");
    expect(await ledgerSpend(db, ledgerId, after(SETTLE_UNKNOWN_AFTER_MS))).toEqual({ spentCents: 0, pendingCents: 3400 });

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_UNKNOWN_AFTER_MS + 1))).toBe(1);
    expect(paypal.calls.charge).toBe(2);
  });

  it("settles an older unknown attempt to captured, turns the hold into spend, and makes one PayPal call", async () => {
    paypal.script = ["unknown", "captured"];
    const id = await unknownAttempt();
    const at = after(31_000);

    expect(await settleOpenAttempts(db, paypal, ledgerId, at)).toBe(1);
    expect(paypal.calls.charge).toBe(2);

    const settled = await row(id);
    expect(settled.state).toBe("captured");
    expect(Number(settled.captured_cents)).toBe(3400);
    expect(Number(settled.reserved_cents)).toBe(0);
    expect(settled.receipt_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(settled.paypal?.orderId).toMatch(/^FAKE-ORDER-/);
    expect(new Date(settled.settled_at as string).toISOString()).toBe(at.toISOString());
    expect(await ledgerSpend(db, ledgerId, at)).toEqual({ spentCents: 3400, pendingCents: 0 });

    // Settled once: another read charges nothing more.
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(120_000))).toBe(0);
    expect(paypal.calls.charge).toBe(2);
  });

  it("releases the hold when the repeat is refused", async () => {
    paypal.script = ["unknown", "refused"];
    const id = await unknownAttempt();

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(1);
    const settled = await row(id);
    expect(settled.state).toBe("allowed_not_charged");
    expect(Number(settled.reserved_cents)).toBe(0);
    expect(Number(settled.captured_cents)).toBe(0);
    expect(await ledgerSpend(db, ledgerId, after(31_000))).toEqual({ spentCents: 0, pendingCents: 0 });
    expect(paypal.calls.charge).toBe(2);
  });

  it("keeps an attempt open, still held, while PayPal still says unknown", async () => {
    paypal.script = ["unknown", "unknown"];
    const id = await unknownAttempt();

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(0);
    expect((await row(id)).state).toBe("unknown");
    expect(await ledgerSpend(db, ledgerId, after(31_000))).toEqual({ spentCents: 0, pendingCents: 3400 });
  });

  it("settles a reserved attempt only after 2 minutes, and leaves a younger one alone", async () => {
    paypal.script = ["unknown"];
    const id = await unknownAttempt();
    // A restart mid-request leaves the row 'reserved' with its PayPal call lost.
    await db.query("UPDATE attempts SET state = 'reserved' WHERE id = $1", [id]);

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_RESERVED_AFTER_MS - 1))).toBe(0);
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_RESERVED_AFTER_MS))).toBe(0);
    expect(paypal.calls.charge).toBe(1);
    expect((await row(id)).state).toBe("reserved");

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_RESERVED_AFTER_MS + 1))).toBe(1);
    expect(paypal.calls.charge).toBe(2);
    expect((await row(id)).state).toBe("captured");
    expect(await ledgerSpend(db, ledgerId, after(SETTLE_RESERVED_AFTER_MS + 1))).toEqual({ spentCents: 3400, pendingCents: 0 });
  });

  it("uses the shorter wait for unknown and the longer wait for reserved, when both are open", async () => {
    paypal.script = ["unknown", "unknown"];
    const unknownId = await unknownAttempt();
    const reservedId = await unknownAttempt();
    await db.query("UPDATE attempts SET state = 'reserved' WHERE id = $1", [reservedId]);

    // At 60 seconds only the unknown one is old enough.
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(60_000))).toBe(1);
    expect((await row(unknownId)).state).toBe("captured");
    expect((await row(reservedId)).state).toBe("reserved");
    expect(paypal.calls.charge).toBe(3);
  });

  it("settles at most five attempts a read, one PayPal call each", async () => {
    paypal.script = Array.from({ length: 6 }, () => "unknown" as const);
    for (let i = 0; i < 6; i++) await unknownAttempt(SPONGE);
    expect(paypal.calls.charge).toBe(6);

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(5);
    expect(paypal.calls.charge).toBe(11);
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(1);
    expect(paypal.calls.charge).toBe(12);
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(0);
    expect(paypal.calls.charge).toBe(12);
  });

  it("never repeats an open attempt older than 5 hours, so it cannot charge twice, and keeps it held", async () => {
    paypal.script = ["unknown"];
    const id = await unknownAttempt();

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_REPEAT_WINDOW_MS))).toBe(0);
    expect(paypal.calls.charge).toBe(1);
    expect((await row(id)).state).toBe("unknown");
    expect(await ledgerSpend(db, ledgerId, after(SETTLE_REPEAT_WINDOW_MS))).toEqual({ spentCents: 0, pendingCents: 3400 });

    // A repeat of the same attempt ID (a retry) does not reach PayPal either.
    const again = await go(LIST_CART, id, after(SETTLE_REPEAT_WINDOW_MS));
    expect(again.attempt?.state).toBe("unknown");
    expect(paypal.calls.charge).toBe(1);

    // Just inside the window it still settles.
    expect(await settleOpenAttempts(db, paypal, ledgerId, after(SETTLE_REPEAT_WINDOW_MS - 1))).toBe(1);
    expect(paypal.calls.charge).toBe(2);
  });

  it("repeats the attempt's own ID as the request ID and the same description", async () => {
    paypal.script = ["unknown"];
    const spy = spyOnCharge();
    const id = await unknownAttempt();

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    const [first, repeat] = spy.mock.calls.map((c) => c[0]);
    expect(first.requestId).toBe(id);
    expect(repeat.requestId).toBe(id);
    expect(repeat.description).toBe(first.description);
    expect(repeat.items).toEqual(first.items);
    expect(repeat.vaultId).toBe(first.vaultId);
    // The repeat tells PayPal's client the first request may have gone through, so a failed
    // sign-in while settling keeps the hold instead of releasing it.
    expect(first.repeat).toBeFalsy();
    expect(repeat.repeat).toBe(true);
  });

  it("sends the approved-by-the-parent description on the repeat of an approved charge", async () => {
    const spy = spyOnCharge();
    const ask = await go([{ productId: "vacuum-filters", quantity: 1 }]);
    expect(ask.attempt?.state).toBe("pending");
    paypal.script = ["unknown"];
    const approved = await decideApproval(
      db,
      paypal,
      { attemptId: ask.attempt!.id, ledgerId, decision: "approve", expectedPublicKey: TEST_PUBLIC_KEY },
      after(1000),
    );
    expect(approved.attempt?.state).toBe("unknown");
    expect(approved.attempt?.rule).toBe(APPROVED_RULE);

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(40_000))).toBe(1);
    const descriptions = spy.mock.calls.map((c) => c[0].description);
    expect(descriptions).toEqual([`${RESTOCK_DESCRIPTION}, approved by the parent`, `${RESTOCK_DESCRIPTION}, approved by the parent`]);
    expect((await row(ask.attempt!.id)).state).toBe("captured");
  });

  it("leaves an attempt open and held when PayPal throws, and settles it on the next read", async () => {
    paypal.script = ["unknown"];
    const id = await unknownAttempt();
    const spy = spyOnCharge().mockRejectedValueOnce(new Error("network down"));

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(0);
    expect((await row(id)).state).toBe("unknown");
    expect(await ledgerSpend(db, ledgerId, after(31_000))).toEqual({ spentCents: 0, pendingCents: 3400 });

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(32_000))).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await row(id)).state).toBe("captured");
  });

  it("does nothing, and calls nobody, when no PayPal account is saved", async () => {
    paypal.script = ["unknown"];
    const id = await unknownAttempt();
    await db.query("DELETE FROM settings");

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(0);
    expect(paypal.calls.charge).toBe(1);
    expect((await row(id)).state).toBe("unknown");
  });

  it("settles only the ledger it was asked about", async () => {
    const other = await getOrCreateVisitorLedger(db, undefined, TEST_SECRETS.MANDATE_SIGNING_KEY, T0);
    paypal.script = ["unknown", "unknown"];
    const mine = await unknownAttempt();
    const theirs = randomUUID();
    expect((await go(LIST_CART, theirs, T0, other.ledgerId)).attempt?.state).toBe("unknown");

    expect(await settleOpenAttempts(db, paypal, ledgerId, after(31_000))).toBe(1);
    expect((await row(mine)).state).toBe("captured");
    expect((await row(theirs)).state).toBe("unknown");
    expect(paypal.calls.charge).toBe(3);
  });
});

describe("chargeDescription", () => {
  const withRule = (rule: string) => ({ rule }) as AttemptRow;

  it("differs for an attempt the parent approved, so its repeat matches its first request", () => {
    expect(chargeDescription(withRule("$120 a week"))).toBe(RESTOCK_DESCRIPTION);
    expect(chargeDescription(withRule(APPROVED_RULE))).toBe(`${RESTOCK_DESCRIPTION}, approved by the parent`);
    expect(chargeDescription(withRule(APPROVED_RULE))).not.toBe(chargeDescription(withRule("$120 a week")));
  });
});
