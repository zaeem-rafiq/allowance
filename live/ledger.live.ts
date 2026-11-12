// Row-lock races on a real Postgres server (U5). PGlite has one connection, so it cannot prove
// these. Set ALLOWANCE_PG_URL to a THROWAWAY local database; the test wipes its schema.
// Example: ALLOWANCE_PG_URL=postgres://allowance@127.0.0.1:54329/allowance_live npm run live -- ledger
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "@/lib/checkout/approvals";
import { checkout, ledgerSpend } from "@/lib/checkout/checkout";
import { createPg, migrate, type Db } from "@/lib/db";
import { HOUR_MS, takeFromCounter } from "@/lib/limits/limits";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { FakePayPal } from "@/lib/paypal/fake";
import { SAVED_PAYPAL_KEY, setSetting } from "@/lib/settings";
import { getOrCreateVisitorLedger } from "@/lib/visitor/ledger";

const URL_ = process.env.ALLOWANCE_PG_URL ?? "";
const KEY = "live-race-".repeat(4); // A stand-in for tests, not a real key.
const PUB = deriveSigningKey(KEY).publicKeyBase64;
const LIST = [
  { productId: "paper-towels", quantity: 1 },
  { productId: "dish-soap", quantity: 1 },
  { productId: "laundry-detergent", quantity: 1 },
  { productId: "trash-bags", quantity: 1 },
  { productId: "sponges", quantity: 1 },
];

let db: Db;
const paypal = new FakePayPal();

beforeAll(async () => {
  const host = URL_ ? new URL(URL_).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("ALLOWANCE_PG_URL must point at a throwaway local database.");
  const wipe = await createPg(URL_);
  await wipe.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await wipe.close();
  // Three servers migrating at once: the advisory lock makes them take turns.
  const pools = await Promise.all([createPg(URL_), createPg(URL_), createPg(URL_)]);
  await Promise.all(pools.map((p) => migrate(p)));
  await Promise.all(pools.slice(1).map((p) => p.close()));
  db = pools[0];
  await setSetting(db, SAVED_PAYPAL_KEY, { paymentTokenId: "FAKE-VAULT", customerId: null, savedAt: new Date().toISOString() });
});

afterAll(async () => db?.close());

async function newLedger() {
  return (await db.transaction((tx) => getOrCreateVisitorLedger(tx, undefined, KEY, new Date()))).ledgerId;
}

const go = (ledgerId: string, cart: unknown, source: "skip" | "restock" = "skip") =>
  checkout(db, paypal, { attemptId: randomUUID(), ledgerId, runId: null, source, cart, expectedPublicKey: PUB }, new Date());

describe("real Postgres races", () => {
  it("lets only one of two concurrent $34 checkouts through when $40 is left", async () => {
    const ledgerId = await newLedger();
    await go(ledgerId, [{ productId: "laundry-detergent", quantity: 5 }, { productId: "dish-soap", quantity: 5 }]);
    const results = await Promise.all([go(ledgerId, LIST), go(ledgerId, LIST)]);
    expect(results.map((r) => r.attempt?.state).sort()).toEqual(["blocked", "captured"]);
  });

  it("never overspends with ten concurrent checkouts", async () => {
    const ledgerId = await newLedger();
    const results = await Promise.all(Array.from({ length: 10 }, () => go(ledgerId, LIST)));
    const captured = results.filter((r) => r.attempt?.state === "captured").length;
    expect(captured).toBe(3);
    const { spentCents, pendingCents } = await ledgerSpend(db, ledgerId, new Date());
    expect(spentCents + pendingCents).toBeLessThanOrEqual(12000);
  });

  it("makes one charge from two concurrent Approve taps", async () => {
    const ledgerId = await newLedger();
    const before = paypal.calls.charge;
    const ask = await go(ledgerId, [{ productId: "vacuum-filters", quantity: 1 }], "restock");
    expect(ask.attempt?.state).toBe("pending");
    const taps = await Promise.all(
      [1, 2].map(() =>
        decideApproval(db, paypal, { attemptId: ask.attempt!.id, ledgerId, decision: "approve", expectedPublicKey: PUB }, new Date()),
      ),
    );
    expect(paypal.calls.charge - before).toBe(1);
    expect(taps.some((t) => t.attempt?.state === "captured")).toBe(true);
  });

  it("lets exactly the limit through when first requests for a new counter arrive together", async () => {
    const key = `race:${randomUUID()}`;
    const at = new Date();
    const results = await Promise.all(Array.from({ length: 8 }, () => takeFromCounter(db, key, 3, HOUR_MS, at)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});
