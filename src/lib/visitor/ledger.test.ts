// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPglite, migrate, type Db } from "@/lib/db";
import { TEST_SECRETS } from "@/lib/mode";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { DEMO_LEDGER_ID, ensureDemoLedger, getOrCreateVisitorLedger } from "./ledger";

const KEY = TEST_SECRETS.MANDATE_SIGNING_KEY;
const T0 = new Date("2026-11-12T03:00:00Z");

describe("ledgers", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createPglite();
    await migrate(db);
  });
  afterEach(async () => db.close());

  it("seeding twice leaves one demo ledger and one mandate version", async () => {
    await ensureDemoLedger(db, KEY, T0);
    await ensureDemoLedger(db, KEY, T0);
    expect(await db.query("SELECT id FROM ledgers WHERE kind = 'demo'")).toHaveLength(1);
    expect(await db.query("SELECT id FROM mandate_versions WHERE ledger_id = $1", [DEMO_LEDGER_ID])).toHaveLength(1);
  });

  it("gives a first visit a new ledger with the demo mandate, and reuses it for the same cookie", async () => {
    const first = await getOrCreateVisitorLedger(db, undefined, KEY, T0);
    expect(first.newCookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const again = await getOrCreateVisitorLedger(db, first.newCookie!, KEY, T0);
    expect(again).toEqual({ ledgerId: first.ledgerId, newCookie: null });
    const mandates = await db.query<{ version: number }>("SELECT version FROM mandate_versions WHERE ledger_id = $1", [first.ledgerId]);
    expect(mandates.map((m) => m.version)).toEqual([1]);
  });

  it("gives two cookies two ledgers, and a forged cookie a new ledger, never an existing one", async () => {
    const a = await getOrCreateVisitorLedger(db, undefined, KEY, T0);
    const b = await getOrCreateVisitorLedger(db, undefined, KEY, T0);
    expect(a.ledgerId).not.toBe(b.ledgerId);
    const forged = await getOrCreateVisitorLedger(db, "A".repeat(43), KEY, T0);
    expect([a.ledgerId, b.ledgerId]).not.toContain(forged.ledgerId);
    expect(forged.newCookie).not.toBe("A".repeat(43));
  });

  it("signs the demo mandate again when the server's signing key changes", async () => {
    const first = await getOrCreateVisitorLedger(db, undefined, KEY, T0);
    const newKey = "a-different-signing-key-for-this-test";
    const again = await getOrCreateVisitorLedger(db, first.newCookie!, newKey, T0);
    expect(again.ledgerId).toBe(first.ledgerId);
    const versions = await db.query<{ version: number; public_key: string }>(
      "SELECT version, public_key FROM mandate_versions WHERE ledger_id = $1 ORDER BY version",
      [first.ledgerId],
    );
    expect(versions).toHaveLength(2);
    expect(versions[1].public_key).toBe(deriveSigningKey(newKey).publicKeyBase64);
    // A new visitor re-signs the demo parent's copy too, and starts from it.
    await getOrCreateVisitorLedger(db, undefined, newKey, T0);
    const demo = await db.query<{ public_key: string }>(
      "SELECT public_key FROM mandate_versions WHERE ledger_id = $1 ORDER BY version DESC LIMIT 1",
      [DEMO_LEDGER_ID],
    );
    expect(demo[0].public_key).toBe(deriveSigningKey(newKey).publicKeyBase64);
  });
});
