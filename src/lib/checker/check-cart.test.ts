// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CATALOG, RESTOCK_LIST, type Product } from "@/lib/catalog/catalog";
import { DEMO_MANDATE } from "@/lib/mandate/demo-mandate";
import type { IntentMandate } from "@/lib/mandate/schema";
import { WEEK_MS, checkCart, spendInWindow, type Verdict } from "./check-cart";

const NOW = new Date("2026-11-12T12:00:00-06:00");

function mandateWith(change: (m: IntentMandate) => void): IntentMandate {
  const m = JSON.parse(JSON.stringify(DEMO_MANDATE)) as IntentMandate;
  change(m);
  return m;
}

function check(
  cart: unknown,
  opts: { spent?: number; pending?: number; now?: Date; mandate?: IntentMandate; catalog?: readonly Product[] } = {},
): Verdict {
  return checkCart({
    mandate: opts.mandate ?? DEMO_MANDATE,
    cart,
    spentCents: opts.spent ?? 0,
    pendingCents: opts.pending ?? 0,
    now: opts.now ?? NOW,
    catalog: opts.catalog,
  });
}

function blocked(v: Verdict) {
  if (v.decision !== "block") throw new Error(`Expected a block, got ${v.decision}.`);
  return v;
}

const RESTOCK = RESTOCK_LIST.map((l) => ({ ...l }));
const line = (productId: string, quantity = 1) => ({ productId, quantity });

describe("spendInWindow", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("adds up charges from the last 7 days", () => {
    expect(
      spendInWindow(
        [
          { amountCents: 1000, at: ago(0) },
          { amountCents: 2000, at: ago(60 * 60 * 1000) },
          { amountCents: 500, at: ago(3 * 24 * 60 * 60 * 1000) },
        ],
        now,
      ),
    ).toBe(3500);
  });

  it("does not count a charge 7 days and 1 second old", () => {
    expect(spendInWindow([{ amountCents: 4000, at: ago(WEEK_MS + 1000) }], now)).toBe(0);
  });

  it("counts a charge 6 days and 23 hours old", () => {
    expect(spendInWindow([{ amountCents: 4000, at: ago(WEEK_MS - 60 * 60 * 1000) }], now)).toBe(4000);
  });

  it("does not count a charge exactly 7 days old, and counts one 1 ms younger", () => {
    expect(spendInWindow([{ amountCents: 4000, at: ago(WEEK_MS) }], now)).toBe(0);
    expect(spendInWindow([{ amountCents: 4000, at: ago(WEEK_MS - 1) }], now)).toBe(4000);
  });

  it("counts a charge dated in the future, so a clock step back cannot free budget", () => {
    expect(spendInWindow([{ amountCents: 4000, at: new Date(now.getTime() + 1) }], now)).toBe(4000);
  });

  it("counts a charge whose time cannot be read, so a bad record never lowers the total", () => {
    expect(spendInWindow([{ amountCents: 700, at: new Date("nonsense") }], now)).toBe(700);
  });

  it("returns 0 for no charges and throws when now is not a real date", () => {
    expect(spendInWindow([], now)).toBe(0);
    expect(() => spendInWindow([], new Date("nonsense"))).toThrow();
  });
});

describe("checkCart: the demo scenarios", () => {
  it("allows the $34 restock list with nothing spent", () => {
    const v = check(RESTOCK);
    expect(v).toMatchObject({
      decision: "allow",
      totalCents: 3400,
      rule: "within $120 a week, household basics only",
      remainingAfterCents: 8600,
    });
    if (v.decision === "allow") expect(v.lines).toHaveLength(5);
  });

  it("blocks the restock list plus a $500 gift card, citing never gift cards", () => {
    const v = blocked(check([...RESTOCK, line("gift-card-500")]));
    expect(v.code).toBe("never_category");
    expect(v.rule).toBe("never gift cards");
    expect(v.reason).toBe("$500 gift card can't be bought under this rule: never gift cards.");
    expect(v.totalCents).toBe(3400 + 50000);
    expect(v.remainingCents).toBe(12000);
  });

  it("blocks an item outside household basics (earbuds), citing household basics only", () => {
    const v = blocked(check([line("wireless-earbuds")]));
    expect(v.code).toBe("outside_allowed");
    expect(v.rule).toBe("household basics only");
    expect(v.reason).toBe("Wireless earbuds can't be bought under this rule: household basics only.");
  });

  it("names every item that is outside the allowed list", () => {
    const m = mandateWith((x) => (x.allowance_rules.allowed_categories = ["cleaning", "laundry"]));
    const v = blocked(check([line("paper-towels"), line("dish-soap"), line("sponges")], { mandate: m }));
    expect(v.code).toBe("outside_allowed");
    expect(v.rule).toBe("only cleaning, laundry");
    expect(v.reason).toBe("Paper towels, 6 rolls and Dish soap can't be bought under this rule: only cleaning, laundry.");
  });

  it("sends the $52 vacuum filters to the parent (needs approval), not a block", () => {
    const v = check([line("vacuum-filters")]);
    expect(v.decision).toBe("needs_approval");
    if (v.decision === "needs_approval") {
      expect(v.rule).toBe("ask me first over $40");
      expect(v.totalCents).toBe(5200);
      expect(v.overLimit.map((l) => l.productId)).toEqual(["vacuum-filters"]);
    }
  });

  it("allows two $30 household items, because the limit is on the unit price", () => {
    const custom: Product[] = [
      { id: "thirty-a", name: "Thirty dollar A", priceCents: 3000, category: "cleaning", description: "A test item." },
      { id: "thirty-b", name: "Thirty dollar B", priceCents: 3000, category: "kitchen", description: "A test item." },
    ];
    const v = check([line("thirty-a"), line("thirty-b")], { catalog: custom });
    expect(v).toMatchObject({ decision: "allow", totalCents: 6000, remainingAfterCents: 6000 });
  });

  it("allows many units of an item at the ask-first limit (the limit is strictly above)", () => {
    const custom: Product[] = [
      { id: "forty", name: "Forty dollar thing", priceCents: 4000, category: "cleaning", description: "A test item." },
      { id: "forty-one", name: "Forty one", priceCents: 4001, category: "cleaning", description: "A test item." },
    ];
    expect(check([line("forty", 3)], { catalog: custom }).decision).toBe("allow");
    expect(check([line("forty-one")], { catalog: custom }).decision).toBe("needs_approval");
  });

  it("blocks a $52 item plus a gift card as never_category, not needs_approval", () => {
    const v = blocked(check([line("vacuum-filters"), line("gift-card-25")]));
    expect(v.code).toBe("never_category");
    expect(v.rule).toBe("never gift cards");
  });

  it("blocks over budget when $100 is spent and the cart is $34, with $20 left", () => {
    const v = blocked(check(RESTOCK, { spent: 10000 }));
    expect(v.code).toBe("over_budget");
    expect(v.rule).toBe("$120 a week");
    expect(v.reason).toBe("This cart is $34, and only $20 is left this week.");
    expect(v.remainingCents).toBe(2000);
    expect(v.totalCents).toBe(3400);
  });

  it("allows a cart that lands exactly on the weekly budget", () => {
    const v = check(RESTOCK, { spent: 8600 });
    expect(v).toMatchObject({ decision: "allow", totalCents: 3400, remainingAfterCents: 0 });
  });

  it("blocks by one cent over the budget", () => {
    const v = blocked(check(RESTOCK, { spent: 8601 }));
    expect(v.code).toBe("over_budget");
    expect(v.remainingCents).toBe(3399);
  });

  it("counts pending amounts against the budget", () => {
    const v = blocked(check(RESTOCK, { spent: 5000, pending: 4000 }));
    expect(v.code).toBe("over_budget");
    expect(v.remainingCents).toBe(3000);
    expect(v.reason).toBe("This cart is $34, and only $30 is left this week.");
    expect(check(RESTOCK, { spent: 5000, pending: 3600 }).decision).toBe("allow");
  });

  it("says nothing is left when the week is already spent", () => {
    const v = blocked(check(RESTOCK, { spent: 12000 }));
    expect(v.remainingCents).toBe(0);
    expect(v.reason).toBe("This cart is $34, and nothing is left this week.");
    const over = blocked(check(RESTOCK, { spent: 20000 }));
    expect(over.remainingCents).toBe(0);
  });

  it("puts over-budget before ask-first", () => {
    const v = blocked(check([line("vacuum-filters")], { spent: 9000 }));
    expect(v.code).toBe("over_budget");
  });

  it("never asks first when the mandate has no ask-first limit", () => {
    const m = mandateWith((x) => (x.allowance_rules.ask_first_unit_price_cents = null));
    expect(check([line("vacuum-filters")], { mandate: m }).decision).toBe("allow");
  });

  it("uses the mandate's own budget, not a fixed one", () => {
    const m = mandateWith((x) => (x.allowance_rules.weekly_budget_cents = 3000));
    const v = blocked(check(RESTOCK, { mandate: m }));
    expect(v.code).toBe("over_budget");
    expect(v.rule).toBe("$30 a week");
    expect(v.remainingCents).toBe(3000);
  });
});

describe("checkCart: expiry", () => {
  it("is not expired on 2026-12-15", () => {
    expect(check(RESTOCK, { now: new Date("2026-12-15T12:00:00Z") }).decision).toBe("allow");
  });

  it("is expired on 2027-01-01T12:00:00Z", () => {
    const v = blocked(check(RESTOCK, { now: new Date("2027-01-01T12:00:00Z") }));
    expect(v.code).toBe("expired");
    expect(v.rule).toBe("mandate expired");
    expect(v.reason).toBe("This spending rule has expired, so nothing more can be bought with it.");
    expect(v.totalCents).toBe(3400);
  });

  it("treats the exact expiry moment as expired and one millisecond before as valid", () => {
    const expiry = new Date("2026-12-31T23:59:59-06:00");
    expect(check(RESTOCK, { now: new Date(expiry.getTime() - 1) }).decision).toBe("allow");
    expect(blocked(check(RESTOCK, { now: expiry })).code).toBe("expired");
  });

  it("reads the expiry with its time zone offset", () => {
    // 2027-01-01T05:59:59Z is the same moment as 2026-12-31T23:59:59-06:00.
    expect(check(RESTOCK, { now: new Date("2027-01-01T05:59:58Z") }).decision).toBe("allow");
    expect(blocked(check(RESTOCK, { now: new Date("2027-01-01T06:00:00Z") })).code).toBe("expired");
  });
});

describe("checkCart: bad input", () => {
  it.each([
    ["quantity 0", [line("sponges", 0)]],
    ["quantity -1", [line("sponges", -1)]],
    ["quantity 1.5", [line("sponges", 1.5)]],
    ["quantity 11", [line("sponges", 11)]],
    ["quantity as text", [{ productId: "sponges", quantity: "2" }]],
    ["an unknown product", [line("hover-board")]],
    ["an empty cart", []],
    ["a cart that is not a list", { productId: "sponges", quantity: 1 }],
    ["a missing cart", undefined],
    ["a null line", [null]],
    ["duplicate lines that add up past 10", [line("sponges", 6), line("sponges", 5)]],
  ])("blocks %s as bad_input", (_name, cart) => {
    const v = blocked(check(cart));
    expect(v.code).toBe("bad_input");
    expect(v.rule).toBe("valid cart");
    expect(v.reason.length).toBeGreaterThan(5);
    expect(v.totalCents).toBe(0);
    expect(v.lines).toEqual([]);
    expect(v.remainingCents).toBe(12000);
  });

  it("gives the plain reasons from the catalog pricing", () => {
    expect(blocked(check([line("sponges", 0)])).reason).toBe("Quantity must be a whole number from 1 to 10.");
    expect(blocked(check([line("xyz")])).reason).toBe("Unknown product: xyz.");
    expect(blocked(check([])).reason).toBe("The cart is empty.");
  });

  it("ignores a price sent by the caller and charges the catalog price", () => {
    const v = check([{ productId: "gift-card-500", quantity: 1, priceCents: 1 }]);
    expect(blocked(v).totalCents).toBe(50000);
  });

  it("reports bad input before an expired mandate", () => {
    const v = blocked(check([], { now: new Date("2030-01-01T00:00:00Z") }));
    expect(v.code).toBe("bad_input");
  });
});

describe("checkCart: fails closed on unreadable state", () => {
  it.each([
    ["spent is NaN", { spent: Number.NaN }],
    ["spent is negative", { spent: -1 }],
    ["spent is not a whole number", { spent: 10.5 }],
    ["spent is infinite", { spent: Number.POSITIVE_INFINITY }],
    ["spent is text", { spent: "0" as unknown as number }],
    ["pending is NaN", { pending: Number.NaN }],
    ["pending is negative", { pending: -500 }],
    ["pending is not a whole number", { pending: 0.1 }],
    ["pending is undefined", { pending: undefined as unknown as number, useUndefinedPending: true }],
    ["now is an invalid date", { now: new Date("nonsense") }],
    ["now is not a date", { now: "2026-11-12" as unknown as Date }],
    ["now is null", { now: null as unknown as Date }],
  ])("blocks when %s", (_name, opts) => {
    const o = opts as { spent?: number; pending?: number; now?: Date; useUndefinedPending?: boolean };
    const v = checkCart({
      mandate: DEMO_MANDATE,
      cart: RESTOCK,
      spentCents: o.spent ?? 0,
      pendingCents: o.useUndefinedPending ? (undefined as unknown as number) : (o.pending ?? 0),
      now: o.now === undefined ? NOW : o.now,
    });
    expect(v.decision).toBe("block");
    if (v.decision === "block") expect(v.code).toBe("bad_input");
  });

  it.each([
    ["an unreadable expiry", (m: IntentMandate) => (m.intent_expiry = "someday")],
    ["a missing expiry", (m: IntentMandate) => (m.intent_expiry = undefined as unknown as string)],
    ["a zero budget", (m: IntentMandate) => (m.allowance_rules.weekly_budget_cents = 0)],
    ["a NaN budget", (m: IntentMandate) => (m.allowance_rules.weekly_budget_cents = Number.NaN)],
    ["a fractional budget", (m: IntentMandate) => (m.allowance_rules.weekly_budget_cents = 100.5)],
    ["a budget as text", (m: IntentMandate) => (m.allowance_rules.weekly_budget_cents = "12000" as unknown as number)],
    ["allowed categories that are not a list", (m: IntentMandate) => (m.allowance_rules.allowed_categories = null as never)],
    ["an unknown allowed category", (m: IntentMandate) => (m.allowance_rules.allowed_categories = ["yachts" as never])],
    ["an unknown never category", (m: IntentMandate) => (m.allowance_rules.never_categories = ["yachts" as never])],
    ["a negative ask-first limit", (m: IntentMandate) => (m.allowance_rules.ask_first_unit_price_cents = -1)],
    ["an undefined ask-first limit", (m: IntentMandate) => (m.allowance_rules.ask_first_unit_price_cents = undefined as never)],
    ["no rules at all", (m: IntentMandate) => (m.allowance_rules = undefined as never)],
  ])("blocks a mandate with %s", (_name, change) => {
    const v = blocked(check(RESTOCK, { mandate: mandateWith(change) }));
    expect(v.code).toBe("bad_input");
  });

  it("blocks a missing mandate", () => {
    const v = checkCart({ mandate: null as never, cart: RESTOCK, spentCents: 0, pendingCents: 0, now: NOW });
    expect(v.decision).toBe("block");
  });
});

describe("checkCart: which rule is reported first", () => {
  it("expired comes before a never-allowed category", () => {
    const v = blocked(check([line("gift-card-25")], { now: new Date("2030-01-01T00:00:00Z") }));
    expect(v.code).toBe("expired");
  });

  it("never comes before outside-allowed", () => {
    const v = blocked(check([line("wireless-earbuds"), line("gift-card-25")]));
    expect(v.code).toBe("never_category");
    expect(v.reason).toBe("$25 gift card can't be bought under this rule: never gift cards.");
  });

  it("outside-allowed comes before over-budget", () => {
    const v = blocked(check([line("wireless-earbuds")], { spent: 12000 }));
    expect(v.code).toBe("outside_allowed");
  });

  it("never wins when a category is in both the allowed and the never list", () => {
    const m = mandateWith((x) => (x.allowance_rules.allowed_categories = ["cleaning", "gift_cards"]));
    const v = blocked(check([line("gift-card-25")], { mandate: m }));
    expect(v.code).toBe("never_category");
  });

  it("never comes before over-budget and before ask-first", () => {
    expect(blocked(check([line("gift-card-500")], { spent: 12000 })).code).toBe("never_category");
    expect(blocked(check([line("vacuum-filters"), line("gift-card-25")])).code).toBe("never_category");
  });
});

describe("checkCart: the verdict itself", () => {
  it("gives the lines in catalog order, whatever order the cart used", () => {
    const v = check([line("sponges"), line("paper-towels"), line("dish-soap", 2)]);
    expect(v.decision).toBe("allow");
    expect(v.lines.map((l) => l.productId)).toEqual(["paper-towels", "dish-soap", "sponges"]);
  });

  it("merges duplicate lines", () => {
    const v = check([line("sponges", 2), line("sponges", 3)]);
    expect(v).toMatchObject({ decision: "allow", totalCents: 2000 });
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0].quantity).toBe(5);
  });

  it("describes a custom allowed list in the allow rule", () => {
    const m = mandateWith((x) => (x.allowance_rules.allowed_categories = ["cleaning", "laundry"]));
    const v = check([line("sponges")], { mandate: m });
    expect(v.decision).toBe("allow");
    if (v.decision === "allow") expect(v.rule).toBe("within $120 a week, only cleaning, laundry");
  });

  it("does not change the mandate or the catalog", () => {
    const before = JSON.stringify(DEMO_MANDATE);
    const catalogBefore = JSON.stringify(CATALOG);
    check(RESTOCK);
    check([line("gift-card-500")], { spent: 99999 });
    expect(JSON.stringify(DEMO_MANDATE)).toBe(before);
    expect(JSON.stringify(CATALOG)).toBe(catalogBefore);
  });
});
