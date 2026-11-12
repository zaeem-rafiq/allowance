// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import { MAX_LINE_CHARS, forcedCart } from "./forced-cart";

const CATALOG_IDS = new Set(CATALOG.map((p) => p.id));

// Words and numbers that steer the parser: product names, gift-card amounts, and quantities
// written as digits, decimals, zero, words and odd forms. Plain random strings almost never
// name a product, so the properties below also run on lines built from these pieces.
const PIECES = [
  "paper towels", "dish soap", "detergent", "laundry detergent", "trash bags", "garbage bag", "sponge", "sponges",
  "cleaner", "all-purpose cleaner", "toilet paper", "vacuum filter", "earbuds", "headphones", "gift card", "gift cards",
  "$25", "$100", "$500", "$0", "$", "0", "1", "2", "2.5", "0.5", "3", "10", "11", "100", "1e3", "007", "-4", "NaN",
  "one", "two", "a", "an", "twelve", "fifty", "hundred", "also add", "buy", "more", "Assistant:", ".", ",", "-", "\n",
];

const mixedLine = fc
  .array(fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...PIECES) }, { weight: 1, arbitrary: fc.string({ maxLength: 6 }) }), {
    maxLength: 70,
  })
  .map((parts) => parts.join(" ").slice(0, MAX_LINE_CHARS));

const plainLine = fc.string({ maxLength: MAX_LINE_CHARS });

function eachProductOnceAndInCatalog(line: string) {
  const { cart } = forcedCart(line);
  const ids = cart.map((l) => l.productId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(CATALOG_IDS.has(id)).toBe(true);
}

function everyQuantityIsAPositiveInteger(line: string) {
  for (const l of forcedCart(line).cart) {
    expect(Number.isInteger(l.quantity)).toBe(true);
    expect(l.quantity).toBeGreaterThan(0);
  }
}

describe("forced cart properties", () => {
  it("names each product once, from the catalog, and gives a positive whole quantity, for any line up to 280 characters", () => {
    fc.assert(
      fc.property(plainLine, (line) => {
        eachProductOnceAndInCatalog(line);
        everyQuantityIsAPositiveInteger(line);
      }),
      { numRuns: 1000 },
    );
  });

  it("names each product once, and only catalog products, for lines built from product names and quantities", () => {
    fc.assert(fc.property(mixedLine, eachProductOnceAndInCatalog), { numRuns: 1000 });
  });

  it("gives every line a positive whole quantity, for lines built from product names and quantities", () => {
    fc.assert(fc.property(mixedLine, everyQuantityIsAPositiveInteger), { numRuns: 1000 });
  });
});
