// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { centsToPayPal, payPalToCents } from "./cents";

describe("cents <-> PayPal string", () => {
  it("round-trips every integer from 0 to 10,000,000", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (c) => {
        expect(payPalToCents(centsToPayPal(c))).toBe(c);
      }),
      { numRuns: 2000 },
    );
  });

  it("always writes a string that matches the PayPal pattern", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (c) => {
        expect(centsToPayPal(c)).toMatch(/^\d+\.\d{2}$/);
      }),
      { numRuns: 1000 },
    );
  });
});
