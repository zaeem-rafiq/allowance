// @vitest-environment node
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPglite, migrate, type Db } from "@/lib/db";
import { PRICES, costMicroUsd } from "./ai-budget";
import { HOUR_MS, takeFromCounter } from "./limits";

const T0 = new Date("2026-11-12T03:00:00Z").getTime();

describe("usage counter properties", () => {
  let db: Db;
  let run = 0;
  beforeAll(async () => {
    db = await createPglite();
    await migrate(db);
  });
  afterAll(async () => db.close());

  const scenario = fc.record({
    limit: fc.integer({ min: 1, max: 20 }),
    calls: fc.integer({ min: 0, max: 40 }),
    windowMs: fc.integer({ min: 1000, max: HOUR_MS }),
    // Raw offsets are folded into the window below, so every call lands inside one window.
    offsets: fc.array(fc.integer({ min: 0, max: 2 * HOUR_MS }), { minLength: 40, maxLength: 40 }),
  });

  it("lets exactly min(calls, limit) calls through inside one window, then opens a new window at windowMs", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ limit, calls, windowMs, offsets }) => {
        const key = `property:${++run}`;
        const folded = offsets
          .slice(0, calls)
          .map((o) => o % windowMs)
          .sort((a, b) => a - b);
        const times = folded.map((o) => T0 + o - (folded[0] ?? 0)); // The first call opens the window at T0.

        const results: boolean[] = [];
        for (const t of times) results.push(await takeFromCounter(db, key, limit, windowMs, new Date(t)));

        const allowed = Math.min(calls, limit);
        expect(results.filter(Boolean)).toHaveLength(allowed);
        // The calls that fit are the first ones; every later call is refused.
        expect(results).toEqual(Array.from({ length: calls }, (_, i) => i < allowed));

        // The first call at or after windowMs later starts a new window and is allowed.
        expect(await takeFromCounter(db, key, limit, windowMs, new Date(T0 + windowMs))).toBe(true);
        // That new window holds `limit` calls in all.
        for (let i = 1; i < limit; i++) {
          expect(await takeFromCounter(db, key, limit, windowMs, new Date(T0 + windowMs + i))).toBe(true);
        }
        expect(await takeFromCounter(db, key, limit, windowMs, new Date(T0 + windowMs + limit))).toBe(false);
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it("keeps separate keys apart", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 15 }), async (limit, calls) => {
        const a = `property:a:${++run}`;
        const b = `property:b:${run}`;
        for (let i = 0; i < calls; i++) await takeFromCounter(db, a, limit, HOUR_MS, new Date(T0));
        // However many calls A used, B still has its whole limit.
        for (let i = 0; i < limit; i++) expect(await takeFromCounter(db, b, limit, HOUR_MS, new Date(T0))).toBe(true);
        expect(await takeFromCounter(db, b, limit, HOUR_MS, new Date(T0))).toBe(false);
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});

describe("costMicroUsd properties", () => {
  const model = fc.constantFrom(...Object.keys(PRICES));
  const tokens = fc.integer({ min: 0, max: 1_000_000_000 });

  it("is a non-negative whole number for any token counts", () => {
    fc.assert(
      fc.property(model, tokens, tokens, (m, input, output) => {
        const cost = costMicroUsd(m, input, output);
        expect(Number.isInteger(cost)).toBe(true);
        expect(cost).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 2000 },
    );
  });

  it("never decreases as either token count grows", () => {
    fc.assert(
      fc.property(model, tokens, tokens, tokens, tokens, (m, input, output, moreInput, moreOutput) => {
        const base = costMicroUsd(m, input, output);
        expect(costMicroUsd(m, input + moreInput, output)).toBeGreaterThanOrEqual(base);
        expect(costMicroUsd(m, input, output + moreOutput)).toBeGreaterThanOrEqual(base);
        expect(costMicroUsd(m, input + moreInput, output + moreOutput)).toBeGreaterThanOrEqual(base);
      }),
      { numRuns: 2000 },
    );
  });

  it("costs nothing for no tokens", () => {
    for (const m of Object.keys(PRICES)) expect(costMicroUsd(m, 0, 0)).toBe(0);
  });

  it("is 0 for an unknown model, whatever the token counts", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }).filter((m) => !Object.keys(PRICES).includes(m)),
        tokens,
        tokens,
        (m, input, output) => {
          expect(costMicroUsd(m, input, output)).toBe(0);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("is 0 for a model named like an inherited object property, never NaN", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"),
        tokens,
        tokens,
        (m, input, output) => {
          expect(costMicroUsd(m, input, output)).toBe(0);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
