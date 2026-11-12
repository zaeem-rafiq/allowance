// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPglite, migrate, type Db } from "@/lib/db";
import { HOUR_MS, addressKey, clientAddress, takeFromCounter } from "./limits";

const T0 = new Date("2026-11-12T03:00:00Z");

describe("usage counters", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createPglite();
    await migrate(db);
  });
  afterEach(async () => db.close());

  it("lets a visitor's 5th run in an hour start and refuses the 6th", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await takeFromCounter(db, "run:ledger:a", 5, HOUR_MS, T0));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("refuses the 31st checkout from one address and leaves another address unaffected", async () => {
    for (let i = 0; i < 30; i++) expect(await takeFromCounter(db, "checkout:addr:x", 30, HOUR_MS, T0)).toBe(true);
    expect(await takeFromCounter(db, "checkout:addr:x", 30, HOUR_MS, T0)).toBe(false);
    expect(await takeFromCounter(db, "checkout:addr:y", 30, HOUR_MS, T0)).toBe(true);
  });

  it("refuses a 4th rule compile in an hour, and opens a new window after an hour", async () => {
    for (let i = 0; i < 3; i++) expect(await takeFromCounter(db, "compile:ledger:a", 3, HOUR_MS, T0)).toBe(true);
    expect(await takeFromCounter(db, "compile:ledger:a", 3, HOUR_MS, T0)).toBe(false);
    expect(await takeFromCounter(db, "compile:ledger:a", 3, HOUR_MS, new Date(T0.getTime() + HOUR_MS))).toBe(true);
  });

  it("fails closed when the counter cannot be read", async () => {
    await db.close();
    await expect(takeFromCounter(db, "run:ledger:a", 5, HOUR_MS, T0)).rejects.toThrow();
    db = await createPglite();
  });
});

describe("client addresses", () => {
  it("are stored only as salted hashes that change every hour", () => {
    const viaCloudflare = new Request("https://example.test/", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    });
    expect(clientAddress(viaCloudflare)).toBe("203.0.113.9");
    // A caller's own X-Forwarded-For entry at the front is not trusted.
    const spoofed = new Request("https://example.test/", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    expect(clientAddress(spoofed)).toBe("203.0.113.9");
    const a = addressKey("203.0.113.9", "salt-salt-salt-salt", T0);
    expect(a).not.toContain("203.0.113.9");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(addressKey("203.0.113.9", "salt-salt-salt-salt", new Date(T0.getTime() + HOUR_MS))).not.toBe(a);
    expect(addressKey("203.0.113.9", "other-salt-other-salt", T0)).not.toBe(a);
  });
});
