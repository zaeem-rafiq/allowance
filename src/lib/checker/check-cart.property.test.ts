// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOG, CATEGORY_LABELS, getProduct, type Category } from "@/lib/catalog/catalog";
import { DEMO_MANDATE } from "@/lib/mandate/demo-mandate";
import type { IntentMandate } from "@/lib/mandate/schema";
import { checkCart } from "./check-cart";

const RUNS = 1000;
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const IDS = CATALOG.map((p) => p.id);
const NOW = new Date("2026-11-12T12:00:00-06:00");
const BEFORE_EXPIRY = new Date("2026-12-01T00:00:00Z");
const AFTER_EXPIRY = new Date("2027-02-01T00:00:00Z");

// Most carts hold cheap household items, so a good share of runs end in "allow".
const cheapIds = ["paper-towels", "dish-soap", "laundry-detergent", "trash-bags", "sponges", "all-purpose-cleaner", "toilet-paper"];
const lineArb = fc.record({
  productId: fc.oneof({ weight: 6, arbitrary: fc.constantFrom(...cheapIds) }, { weight: 3, arbitrary: fc.constantFrom(...IDS) }),
  quantity: fc.integer({ min: 1, max: 3 }),
});
// One line per product, so no cart is rejected for adding up to more than 10 of one product.
const cartArb = fc.uniqueArray(lineArb, { selector: (l) => l.productId, minLength: 1, maxLength: 5 });

// How much of the weekly budget is already spent or pending, as a percentage. Skewed low so many carts fit.
const spentPctArb = fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 0, max: 40 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 130 }) });
const pendingPctArb = fc.integer({ min: 0, max: 20 });
const pct = (budget: number, p: number): number => Math.floor((budget * p) / 100);

const mandateArb: fc.Arbitrary<IntentMandate> = fc
  .record({
    budget: fc.integer({ min: 3000, max: 40000 }),
    allowed: fc.oneof(
      { weight: 3, arbitrary: fc.constant<Category[]>(["cleaning", "paper_goods", "laundry", "kitchen"]) },
      { weight: 1, arbitrary: fc.uniqueArray(fc.constantFrom(...CATEGORIES), { minLength: 1, maxLength: 8 }) },
    ),
    never: fc.uniqueArray(fc.constantFrom(...CATEGORIES), { maxLength: 3 }),
    askFirst: fc.option(fc.integer({ min: 0, max: 8000 }), { nil: null }),
  })
  .map(({ budget, allowed, never, askFirst }) => {
    const m = JSON.parse(JSON.stringify(DEMO_MANDATE)) as IntentMandate;
    m.allowance_rules = {
      weekly_budget_cents: budget,
      allowed_categories: allowed,
      never_categories: never,
      ask_first_unit_price_cents: askFirst,
    };
    return m;
  });

function sumLines(cart: { productId: string; quantity: number }[]): number {
  return cart.reduce((total, l) => total + (getProduct(l.productId)?.priceCents ?? 0) * l.quantity, 0);
}

describe("checkCart properties", () => {
  it("an allow never takes spent + pending + total past the weekly budget", () => {
    const seen = { allow: 0, needs_approval: 0, block: 0 };
    fc.assert(
      fc.property(
        mandateArb,
        cartArb,
        spentPctArb,
        pendingPctArb,
        (mandate, cart, spentPct, pendingPct) => {
          const budget = mandate.allowance_rules.weekly_budget_cents;
          const spent = pct(budget, spentPct);
          const pending = pct(budget, pendingPct);
          const v = checkCart({ mandate, cart, spentCents: spent, pendingCents: pending, now: NOW });
          seen[v.decision] += 1;
          if (v.decision === "allow") {
            expect(spent + pending + v.totalCents).toBeLessThanOrEqual(budget);
            expect(v.remainingAfterCents).toBe(budget - spent - pending - v.totalCents);
            expect(v.remainingAfterCents).toBeGreaterThanOrEqual(0);
            // An allow also respects the category and ask-first rules.
            for (const l of v.lines) {
              expect(mandate.allowance_rules.allowed_categories).toContain(l.category);
              expect(mandate.allowance_rules.never_categories).not.toContain(l.category);
              const limit = mandate.allowance_rules.ask_first_unit_price_cents;
              if (limit !== null) expect(l.unitPriceCents).toBeLessThanOrEqual(limit);
            }
          }
          if (v.decision === "needs_approval") {
            expect(spent + pending + v.totalCents).toBeLessThanOrEqual(budget);
          }
          if (v.decision === "block" && v.code === "over_budget") {
            expect(spent + pending + v.totalCents).toBeGreaterThan(budget);
            expect(v.remainingCents).toBe(Math.max(0, budget - spent - pending));
          }
        },
      ),
      { numRuns: RUNS },
    );
    // The generator must reach every outcome often enough for the property to mean something.
    expect(seen.allow).toBeGreaterThan(100);
    expect(seen.needs_approval).toBeGreaterThan(20);
    expect(seen.block).toBeGreaterThan(100);
  });

  it("a cart with a never-allowed item is never allowed and never sent for approval", () => {
    fc.assert(
      fc.property(
        mandateArb,
        cartArb,
        fc.nat({ max: 5 }),
        spentPctArb,
        fc.boolean(),
        (base, cart, pick, spentPct, expired) => {
          const spent = pct(base.allowance_rules.weekly_budget_cents, spentPct);
          const cartCategories = cart.map((l) => getProduct(l.productId)!.category);
          const bad = cartCategories[pick % cartCategories.length];
          const mandate: IntentMandate = JSON.parse(JSON.stringify(base));
          if (!mandate.allowance_rules.never_categories.includes(bad)) {
            mandate.allowance_rules.never_categories.push(bad);
          }
          const v = checkCart({
            mandate,
            cart,
            spentCents: spent,
            pendingCents: 0,
            now: expired ? AFTER_EXPIRY : BEFORE_EXPIRY,
          });
          expect(v.decision).toBe("block");
          if (v.decision === "block") {
            expect(v.code).toBe(expired ? "expired" : "never_category");
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("the total is the sum of unit price x quantity, and line order never changes the verdict", () => {
    fc.assert(
      fc.property(
        mandateArb,
        cartArb,
        spentPctArb,
        pendingPctArb,
        fc.integer({ min: 0, max: 1_000_000 }),
        (mandate, cart, spentPct, pendingPct, salt) => {
          const spent = pct(mandate.allowance_rules.weekly_budget_cents, spentPct);
          const pending = pct(mandate.allowance_rules.weekly_budget_cents, pendingPct);
          const verdict = checkCart({ mandate, cart, spentCents: spent, pendingCents: pending, now: NOW });
          expect(verdict.totalCents).toBe(sumLines(cart));
          expect(verdict.lines.reduce((t, l) => t + l.unitPriceCents * l.quantity, 0)).toBe(verdict.totalCents);

          // A fixed shuffle, chosen by salt, and a plain reversal.
          const shuffled = [...cart].sort((a, b) => ((a.productId.length * 31 + a.quantity + salt) % 7) - ((b.productId.length * 31 + b.quantity + salt) % 7) || (a.productId < b.productId ? -1 : 1));
          const reversed = [...cart].reverse();
          for (const other of [shuffled, reversed]) {
            expect(checkCart({ mandate, cart: other, spentCents: spent, pendingCents: pending, now: NOW })).toEqual(verdict);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("splitting a line into duplicates never changes the verdict", () => {
    fc.assert(
      fc.property(mandateArb, cartArb, spentPctArb, (mandate, cart, spentPct) => {
        const spent = pct(mandate.allowance_rules.weekly_budget_cents, spentPct);
        const whole = checkCart({ mandate, cart, spentCents: spent, pendingCents: 0, now: NOW });
        const split = cart.flatMap((l) =>
          l.quantity > 1
            ? [
                { productId: l.productId, quantity: 1 },
                { productId: l.productId, quantity: l.quantity - 1 },
              ]
            : [l],
        );
        const merged = checkCart({ mandate, cart: split, spentCents: spent, pendingCents: 0, now: NOW });
        // Each product has at most 3 units here, so the split lines always merge back to a valid line.
        expect(whole.decision === "block" && whole.code === "bad_input").toBe(false);
        expect(merged).toEqual(whole);
      }),
      { numRuns: RUNS },
    );
  });

  it("nothing is ever allowed when the spending figures or the date are unreadable", () => {
    const badNumber = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.integer({ min: -100000, max: -1 }),
      fc.double({ min: 0.01, max: 1000, noNaN: true }).filter((n) => !Number.isInteger(n)),
    );
    fc.assert(
      fc.property(mandateArb, cartArb, badNumber, fc.boolean(), (mandate, cart, bad, onSpent) => {
        const v = checkCart({
          mandate,
          cart,
          spentCents: onSpent ? bad : 0,
          pendingCents: onSpent ? 0 : bad,
          now: NOW,
        });
        expect(v.decision).toBe("block");
      }),
      { numRuns: RUNS },
    );
  });
});
