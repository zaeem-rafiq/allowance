// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPglite, migrate } from "./index";

describe("migrations", () => {
  it("run twice on a fresh database, and the second run changes nothing", async () => {
    const db = await createPglite();
    const first = await migrate(db);
    expect(first).toContain("0001_core");
    const second = await migrate(db);
    expect(second).toEqual([]);
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(["ledgers", "mandate_versions", "attempts", "runs", "run_steps", "settings"]),
    );
    await db.close();
  });

  it("rolls back a failed transaction", async () => {
    const db = await createPglite();
    await migrate(db);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO settings (key, value) VALUES ('x', '1')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.query("SELECT * FROM settings WHERE key = 'x'")).toEqual([]);
    await db.close();
  });
});
