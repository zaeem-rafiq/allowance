// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, migrate, type Db } from "@/lib/db";
import { FakePayPal } from "@/lib/paypal/fake";
import { finishSave, getSavedPayPal, startSave } from "./paypal-save";

const NOW = new Date("2026-11-11T21:00:00Z");

describe("saving PayPal", () => {
  let db: Db;
  const paypal = new FakePayPal();
  const owner = { nonce: "owner-a", issuedAt: NOW.getTime() };

  beforeEach(async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    db = await createPglite();
    await migrate(db);
    paypal.reset();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  it("saves once the owner approves on PayPal's page", async () => {
    const url = await startSave(db, paypal, owner, "https://example.test", NOW);
    const token = new URL(url).searchParams.get("token")!;
    expect(await finishSave(db, paypal, owner, token, NOW)).toBe("saved");
    expect((await getSavedPayPal(db))?.paymentTokenId).toBe(`FAKE-VAULT-${token}`);
  });

  it("refuses a return whose setup token this owner session did not start", async () => {
    const url = await startSave(db, paypal, owner, "https://example.test", NOW);
    const token = new URL(url).searchParams.get("token")!;
    expect(await finishSave(db, paypal, { nonce: "someone-else", issuedAt: 0 }, token, NOW)).toBe("refused");
    expect(await finishSave(db, paypal, owner, "FAKE-SETUP-999", NOW)).toBe("refused");
    expect(await finishSave(db, paypal, owner, null, NOW)).toBe("refused");
    expect(await getSavedPayPal(db)).toBeNull();
  });

  it("keeps the earlier account when a second save is not confirmed, and replaces it once confirmed", async () => {
    const first = new URL(await startSave(db, paypal, owner, "https://example.test", NOW)).searchParams.get("token")!;
    await finishSave(db, paypal, owner, first, NOW);
    const before = await getSavedPayPal(db);
    const second = new URL(await startSave(db, paypal, owner, "https://example.test", NOW)).searchParams.get("token")!;
    expect(await getSavedPayPal(db)).toEqual(before);
    expect(await finishSave(db, paypal, owner, second, NOW)).toBe("saved");
    expect((await getSavedPayPal(db))?.paymentTokenId).toBe(`FAKE-VAULT-${second}`);
  });
});
