// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_BASICS } from "@/lib/catalog/catalog";
import { DEMO_MANDATE, DEMO_RULE_TEXT, VISITOR_MAX_WEEKLY_BUDGET_CENTS } from "./demo-mandate";
import { describeRules, intentMandateSchema, parseMandate, type MandateRules } from "./schema";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("DEMO_MANDATE", () => {
  it("is the demo rule exactly", () => {
    expect(DEMO_RULE_TEXT).toBe("$120 a week, household basics only, nothing over $40 without asking me, never gift cards.");
    expect(DEMO_MANDATE).toEqual({
      type: "IntentMandate",
      natural_language_description: DEMO_RULE_TEXT,
      merchants: ["Allowance demo store"],
      skus: null,
      requires_refundability: false,
      user_cart_confirmation_required: false,
      intent_expiry: "2026-12-31T23:59:59-06:00",
      allowance_rules: {
        weekly_budget_cents: 12000,
        allowed_categories: HOUSEHOLD_BASICS,
        never_categories: ["gift_cards"],
        ask_first_unit_price_cents: 4000,
      },
      not_enforced: [],
    });
    expect(VISITOR_MAX_WEEKLY_BUDGET_CENTS).toBe(12000);
  });

  it("passes its own schema", () => {
    expect(parseMandate(DEMO_MANDATE)).toEqual(DEMO_MANDATE);
    expect(intentMandateSchema.safeParse(DEMO_MANDATE).success).toBe(true);
  });

  it("does not share its category arrays with HOUSEHOLD_BASICS", () => {
    expect(DEMO_MANDATE.allowance_rules.allowed_categories).not.toBe(HOUSEHOLD_BASICS);
  });
});

describe("parseMandate", () => {
  it("accepts a mandate with skus, ask-first null and a Z-time expiry", () => {
    const m = clone(DEMO_MANDATE);
    m.skus = ["paper-towels"];
    m.allowance_rules.ask_first_unit_price_cents = null;
    m.intent_expiry = "2027-01-01T00:00:00Z";
    expect(parseMandate(m)).toEqual(m);
  });

  it("throws on unknown keys at the top level and inside the rules", () => {
    const top = { ...clone(DEMO_MANDATE), extra: 1 };
    expect(() => parseMandate(top)).toThrow();
    const nested = clone(DEMO_MANDATE) as unknown as { allowance_rules: Record<string, unknown> };
    nested.allowance_rules.surprise = true;
    expect(() => parseMandate(nested)).toThrow();
  });

  it("throws on an unknown category", () => {
    const m = clone(DEMO_MANDATE) as unknown as { allowance_rules: { allowed_categories: string[] } };
    m.allowance_rules.allowed_categories = ["cleaning", "yachts"];
    expect(() => parseMandate(m)).toThrow();
    const n = clone(DEMO_MANDATE) as unknown as { allowance_rules: { never_categories: string[] } };
    n.allowance_rules.never_categories = ["yachts"];
    expect(() => parseMandate(n)).toThrow();
  });

  it("throws on bad money values", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "12000", null]) {
      const m = clone(DEMO_MANDATE) as unknown as { allowance_rules: Record<string, unknown> };
      m.allowance_rules.weekly_budget_cents = bad;
      expect(() => parseMandate(m), String(bad)).toThrow();
    }
    for (const bad of [-1, 1.5, "4000"]) {
      const m = clone(DEMO_MANDATE) as unknown as { allowance_rules: Record<string, unknown> };
      m.allowance_rules.ask_first_unit_price_cents = bad;
      expect(() => parseMandate(m), String(bad)).toThrow();
    }
  });

  it("throws when the allowed list is empty", () => {
    const m = clone(DEMO_MANDATE);
    m.allowance_rules.allowed_categories = [];
    expect(() => parseMandate(m)).toThrow();
  });

  it("throws on a bad expiry", () => {
    for (const bad of ["tomorrow", "2026-12-31", "2026-12-31T23:59:59", "2026-02-30T10:00:00Z", ""]) {
      const m = clone(DEMO_MANDATE);
      m.intent_expiry = bad;
      expect(() => parseMandate(m), bad).toThrow();
    }
  });

  it("throws on strings longer than 280 characters", () => {
    const long = "x".repeat(281);
    const a = clone(DEMO_MANDATE);
    a.natural_language_description = long;
    expect(() => parseMandate(a)).toThrow();
    const b = clone(DEMO_MANDATE);
    b.merchants = [long];
    expect(() => parseMandate(b)).toThrow();
    const c = clone(DEMO_MANDATE);
    c.not_enforced = [long];
    expect(() => parseMandate(c)).toThrow();
    const ok = clone(DEMO_MANDATE);
    ok.natural_language_description = "x".repeat(280);
    expect(() => parseMandate(ok)).not.toThrow();
  });

  it("throws on a wrong type tag, missing fields and non-objects", () => {
    expect(() => parseMandate({ ...clone(DEMO_MANDATE), type: "CartMandate" })).toThrow();
    const missing = clone(DEMO_MANDATE) as unknown as Record<string, unknown>;
    delete missing.allowance_rules;
    expect(() => parseMandate(missing)).toThrow();
    for (const bad of [null, undefined, "mandate", 7, []]) expect(() => parseMandate(bad)).toThrow();
  });
});

describe("describeRules", () => {
  const base: MandateRules = {
    weekly_budget_cents: 12000,
    allowed_categories: ["cleaning", "paper_goods", "laundry", "kitchen"],
    never_categories: ["gift_cards"],
    ask_first_unit_price_cents: 4000,
  };

  it("describes the demo rule in the fixed order", () => {
    expect(describeRules(DEMO_MANDATE.allowance_rules)).toEqual([
      "$120 a week",
      "household basics only",
      "ask me first over $40",
      "never gift cards",
    ]);
  });

  it("treats the household list as a set, in any order", () => {
    const reordered: MandateRules = { ...base, allowed_categories: ["kitchen", "laundry", "paper_goods", "cleaning"] };
    expect(describeRules(reordered)[1]).toBe("household basics only");
  });

  it("lists other allowed categories by label", () => {
    const rules: MandateRules = { ...base, allowed_categories: ["cleaning", "laundry"] };
    expect(describeRules(rules)[1]).toBe("only cleaning, laundry");
    const mixed: MandateRules = { ...base, allowed_categories: ["paper_goods", "toys"] };
    expect(describeRules(mixed)[1]).toBe("only paper goods, toys");
    const superset: MandateRules = { ...base, allowed_categories: [...HOUSEHOLD_BASICS, "snacks"] };
    expect(describeRules(superset)[1]).toBe("only cleaning, paper goods, laundry, kitchen, snacks");
  });

  it("omits the ask-first line when it is null", () => {
    expect(describeRules({ ...base, ask_first_unit_price_cents: null })).toEqual([
      "$120 a week",
      "household basics only",
      "never gift cards",
    ]);
  });

  it("writes one never line per category and none when there are none", () => {
    expect(describeRules({ ...base, never_categories: ["gift_cards", "electronics"] }).slice(-2)).toEqual([
      "never gift cards",
      "never electronics",
    ]);
    expect(describeRules({ ...base, never_categories: [] })).toEqual([
      "$120 a week",
      "household basics only",
      "ask me first over $40",
    ]);
  });

  it("shows cents when the budget or limit is not whole dollars", () => {
    expect(describeRules({ ...base, weekly_budget_cents: 12050, ask_first_unit_price_cents: 4099 })).toEqual([
      "$120.50 a week",
      "household basics only",
      "ask me first over $40.99",
      "never gift cards",
    ]);
  });
});
