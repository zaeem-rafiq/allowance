// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, type Category } from "@/lib/catalog/catalog";
import { parseMandate, type IntentMandate } from "./schema";
import { canonicalJson, mandateHash, signMandate, verifySignedMandate, type SignedMandate } from "./sign";

// A fake, low-entropy secret that only these tests use.
const SECRET = "test-secret-for-unit-tests-only";
const RUNS = 1000;

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const categoryArb = fc.constantFrom(...CATEGORIES);

const mandateArb: fc.Arbitrary<IntentMandate> = fc.record({
  type: fc.constant("IntentMandate" as const),
  natural_language_description: fc.string({ unit: "grapheme", minLength: 1, maxLength: 80 }),
  merchants: fc.array(fc.string({ unit: "grapheme", minLength: 1, maxLength: 30 }), { maxLength: 3 }),
  skus: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 4 }), { nil: null }),
  requires_refundability: fc.boolean(),
  user_cart_confirmation_required: fc.boolean(),
  intent_expiry: fc.constantFrom("2026-12-31T23:59:59-06:00", "2027-01-01T00:00:00Z", "2026-11-12T12:00:00+05:30"),
  allowance_rules: fc.record({
    weekly_budget_cents: fc.integer({ min: 1, max: 10_000_000 }),
    allowed_categories: fc.uniqueArray(categoryArb, { minLength: 1, maxLength: 8 }),
    never_categories: fc.uniqueArray(categoryArb, { maxLength: 8 }),
    ask_first_unit_price_cents: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
  }),
  not_enforced: fc.array(fc.string({ unit: "grapheme", minLength: 1, maxLength: 40 }), { maxLength: 3 }),
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Changes exactly one thing, and always to a value that differs from the original. */
const MUTATIONS: { name: string; apply: (m: IntentMandate) => void }[] = [
  { name: "budget", apply: (m) => void (m.allowance_rules.weekly_budget_cents += 1) },
  {
    name: "allowed category",
    apply: (m) => void (m.allowance_rules.allowed_categories = toggle(m.allowance_rules.allowed_categories, "toys")),
  },
  {
    name: "never category",
    apply: (m) => void (m.allowance_rules.never_categories = toggle(m.allowance_rules.never_categories, "electronics")),
  },
  { name: "expiry", apply: (m) => void (m.intent_expiry = m.intent_expiry === "2099-01-01T00:00:00Z" ? "2098-01-01T00:00:00Z" : "2099-01-01T00:00:00Z") },
  { name: "description", apply: (m) => void (m.natural_language_description += "!") },
  {
    name: "ask-first limit",
    apply: (m) =>
      void (m.allowance_rules.ask_first_unit_price_cents =
        m.allowance_rules.ask_first_unit_price_cents === null ? 0 : m.allowance_rules.ask_first_unit_price_cents + 1),
  },
  { name: "not_enforced", apply: (m) => void (m.not_enforced = [...m.not_enforced, "extra clause"]) },
  { name: "merchants", apply: (m) => void (m.merchants = [...m.merchants, "extra merchant"]) },
  { name: "refundability", apply: (m) => void (m.requires_refundability = !m.requires_refundability) },
];

/** A fixed pseudo-random order for object keys, chosen by `salt`, applied at every level. */
function reorderKeys(value: unknown, salt: number): unknown {
  if (Array.isArray(value)) return value.map((item) => reorderKeys(item, salt));
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    const score = (key: string): number => {
      let h = salt | 0;
      for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
      return h;
    };
    entries.sort((a, b) => score(a[0]) - score(b[0]) || (a[0] < b[0] ? -1 : 1));
    if (salt % 2 === 1) entries.reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, reorderKeys(v, salt)]));
  }
  return value;
}

describe("generator sanity", () => {
  it("only produces mandates that pass the real schema", () => {
    fc.assert(
      fc.property(mandateArb, (m) => {
        expect(() => parseMandate(m)).not.toThrow();
      }),
      { numRuns: RUNS },
    );
  });
});

describe("signed mandates", () => {
  it("always verify, also after a JSON round trip", () => {
    fc.assert(
      fc.property(mandateArb, (m) => {
        const signed = signMandate(m, SECRET);
        expect(verifySignedMandate(signed)).toBe(true);
        expect(verifySignedMandate(JSON.parse(JSON.stringify(signed)) as SignedMandate)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("fail when any one field is changed, with the old hash or a recomputed one", () => {
    fc.assert(
      fc.property(mandateArb, fc.nat({ max: MUTATIONS.length - 1 }), (m, which) => {
        const signed = signMandate(m, SECRET);
        const forged = clone(signed);
        MUTATIONS[which].apply(forged.mandate);
        // Guard against a vacuous pass: the mutation really changed the data.
        expect(canonicalJson(forged.mandate)).not.toBe(canonicalJson(m));
        expect(verifySignedMandate(forged)).toBe(false);
        forged.hash = mandateHash(forged.mandate);
        expect(verifySignedMandate(forged)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it("do not verify under a different public key", () => {
    fc.assert(
      fc.property(mandateArb, (m) => {
        const signed = signMandate(m, SECRET);
        const other = signMandate(m, "a-different-fake-secret-for-tests");
        expect(verifySignedMandate({ ...signed, publicKey: other.publicKey })).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("key order", () => {
  it("never changes the canonical text, the hash or the signature", () => {
    fc.assert(
      fc.property(mandateArb, fc.integer({ min: 0, max: 1_000_000 }), (m, salt) => {
        const shuffled = reorderKeys(m, salt) as IntentMandate;
        expect(canonicalJson(shuffled)).toBe(canonicalJson(m));
        expect(mandateHash(shuffled)).toBe(mandateHash(m));
        const a = signMandate(m, SECRET);
        const b = signMandate(shuffled, SECRET);
        expect(b.signature).toBe(a.signature);
        // A record that arrives with its keys in another order still verifies.
        expect(verifySignedMandate({ ...a, mandate: shuffled })).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("really does reorder the keys (the property is not vacuous)", () => {
    let reordered = 0;
    fc.assert(
      fc.property(mandateArb, fc.integer({ min: 0, max: 1_000_000 }), (m, salt) => {
        const shuffled = reorderKeys(m, salt) as IntentMandate;
        if (JSON.stringify(shuffled) !== JSON.stringify(m)) reordered += 1;
      }),
      { numRuns: 200 },
    );
    expect(reordered).toBeGreaterThan(100);
  });
});
