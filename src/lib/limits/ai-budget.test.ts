// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPglite, migrate, type Db } from "@/lib/db";
import { aiBudgetState, centralDay, costMicroUsd, dailyCapMicroUsd, recordAiSpend } from "./ai-budget";

describe("AI budget", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createPglite();
    await migrate(db);
  });
  afterEach(async () => db.close());

  it("prices Haiku and Sonnet calls in millionths of a dollar, and the scripted fakes at zero", () => {
    expect(costMicroUsd("claude-haiku-5-5", 1_000_000, 0)).toBe(100_000);
    expect(costMicroUsd("claude-haiku-5-5", 0, 1_000_000)).toBe(500_000);
    expect(costMicroUsd("claude-sonnet-5-5", 1000, 1000)).toBe(12_000);
    expect(costMicroUsd("scripted-agent", 5000, 5000)).toBe(0);
  });

  it("uses $1.25 a day through November 30 and $2.00 from December 1", () => {
    expect(dailyCapMicroUsd("2026-11-30")).toBe(1_250_000);
    expect(dailyCapMicroUsd("2026-12-01")).toBe(2_000_000);
    expect(centralDay(new Date("2026-12-01T05:59:00Z"))).toBe("2026-11-30");
  });

  it("makes no AI call once today's spend reaches the daily cap", async () => {
    const now = new Date("2026-11-12T18:00:00Z");
    expect(await aiBudgetState(db, now)).toEqual({ open: true });
    await recordAiSpend(db, now, 1_250_000);
    expect(await aiBudgetState(db, now)).toEqual({ open: false, reason: "daily" });
    expect(await aiBudgetState(db, new Date("2026-11-13T18:00:00Z"))).toEqual({ open: true });
  });

  it("stops at $55 in total", async () => {
    for (let d = 1; d <= 28; d++) {
      await recordAiSpend(db, new Date(Date.UTC(2026, 10, 12 + d, 18)), 2_000_000);
    }
    expect(await aiBudgetState(db, new Date("2026-12-14T18:00:00Z"))).toEqual({ open: false, reason: "total" });
  });

  it("turns the AI off after December 15, 2026", async () => {
    expect((await aiBudgetState(db, new Date("2026-12-15T23:00:00Z"))).open).toBe(true);
    expect(await aiBudgetState(db, new Date("2026-12-16T18:00:00Z"))).toEqual({ open: false, reason: "ended" });
  });
});
