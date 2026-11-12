// @vitest-environment node
import { createHash, createPrivateKey, createPublicKey, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEMO_MANDATE } from "./demo-mandate";
import type { IntentMandate } from "./schema";
import {
  canonicalJson,
  deriveSigningKey,
  mandateHash,
  signMandate,
  verifySignedMandate,
  type SignedMandate,
} from "./sign";

// A fake, low-entropy secret that only these tests use.
const SECRET = "test-secret-for-unit-tests-only";
const OTHER_SECRET = "another-fake-secret-for-tests";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("canonicalJson", () => {
  it("sorts keys recursively and writes no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[3,2,1]},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("writes strings, numbers, booleans and null as JSON", () => {
    expect(canonicalJson("a\"b\n")).toBe('"a\\"b\\n"');
    expect(canonicalJson(12000)).toBe("12000");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  it("sorts keys by code unit, not by locale", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _: 4, é: 5 })).toBe('{"B":2,"_":4,"a":3,"b":1,"é":5}');
  });

  it("gives the same text for the same data in any key order", () => {
    expect(canonicalJson({ x: 1, y: { p: 1, q: 2 } })).toBe(canonicalJson({ y: { q: 2, p: 1 }, x: 1 }));
  });

  it("throws on values JSON cannot carry exactly", () => {
    for (const bad of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      () => 1,
      Symbol("s"),
      BigInt(10),
      new Date(0),
      new Map(),
      new Set(),
      /x/,
      new (class Thing {})(),
      { a: undefined },
      [undefined],
      { nested: { deeper: [1, () => 2] } },
    ]) {
      expect(() => canonicalJson(bad), String(bad)).toThrow();
    }
  });

  it("escapes lone surrogates so two different strings never share the same bytes", () => {
    expect(canonicalJson("\ud800")).toBe('"\\ud800"');
    expect(canonicalJson("\ud800")).not.toBe(canonicalJson("\ufffd"));
  });

  it("accepts objects with a null prototype", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
  });
});

describe("mandateHash", () => {
  it("is the SHA-256 hex of the canonical JSON", () => {
    const expected = createHash("sha256").update(canonicalJson(DEMO_MANDATE)).digest("hex");
    expect(mandateHash(DEMO_MANDATE)).toBe(expected);
    expect(mandateHash(DEMO_MANDATE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known value so the format cannot drift", () => {
    expect(createHash("sha256").update('{"a":1}').digest("hex")).toBe(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    );
    expect(mandateHash({ b: 0, a: 1 } as unknown as IntentMandate)).toBe(
      createHash("sha256").update('{"a":1,"b":0}').digest("hex"),
    );
  });

  it("changes when any rule changes", () => {
    const m = clone(DEMO_MANDATE);
    m.allowance_rules.weekly_budget_cents += 1;
    expect(mandateHash(m)).not.toBe(mandateHash(DEMO_MANDATE));
  });
});

describe("deriveSigningKey", () => {
  it("is deterministic for one secret and different for another", () => {
    const a = deriveSigningKey(SECRET);
    const b = deriveSigningKey(SECRET);
    const c = deriveSigningKey(OTHER_SECRET);
    expect(a.publicKeyBase64).toBe(b.publicKeyBase64);
    expect(a.publicKeyBase64).not.toBe(c.publicKeyBase64);
  });

  it("gives a 32-byte raw public key in base64", () => {
    const { publicKeyBase64 } = deriveSigningKey(SECRET);
    expect(Buffer.from(publicKeyBase64, "base64")).toHaveLength(32);
    expect(Buffer.from(publicKeyBase64, "base64").toString("base64")).toBe(publicKeyBase64);
  });

  it("builds a real Ed25519 private key whose public half matches the one it reports", () => {
    const { privateKey, publicKeyBase64 } = deriveSigningKey(SECRET);
    expect(privateKey.type).toBe("private");
    expect(privateKey.asymmetricKeyType).toBe("ed25519");
    const jwk = createPublicKey(privateKey).export({ format: "jwk" });
    expect(Buffer.from(jwk.x as string, "base64url").toString("base64")).toBe(publicKeyBase64);
    // Round trip through PKCS#8 as an independent check of the key bytes.
    const der = privateKey.export({ format: "der", type: "pkcs8" });
    expect(createPrivateKey({ key: der, format: "der", type: "pkcs8" }).asymmetricKeyType).toBe("ed25519");
  });

  it("derives a pinned key from the test secret so the derivation cannot drift", () => {
    expect(deriveSigningKey(SECRET).publicKeyBase64).toBe("ga6fERryMPo+CcJd0ZHZ1wpwYRRrbPoUKMg6OToGS74=");
  });

  it("rejects secrets shorter than 16 characters", () => {
    expect(() => deriveSigningKey("")).toThrow();
    expect(() => deriveSigningKey("short")).toThrow();
    expect(() => deriveSigningKey("123456789012345")).toThrow();
    expect(() => deriveSigningKey("1234567890123456")).not.toThrow();
    expect(() => deriveSigningKey(undefined as unknown as string)).toThrow();
  });
});

describe("signMandate and verifySignedMandate", () => {
  const signed = signMandate(DEMO_MANDATE, SECRET);

  it("produces a record with hash, signature and public key", () => {
    expect(signed.mandate).toEqual(DEMO_MANDATE);
    expect(signed.hash).toBe(mandateHash(DEMO_MANDATE));
    expect(signed.publicKey).toBe(deriveSigningKey(SECRET).publicKeyBase64);
    expect(Buffer.from(signed.signature, "base64")).toHaveLength(64);
  });

  it("signs the same bytes the same way every time (Ed25519 is deterministic)", () => {
    expect(signMandate(DEMO_MANDATE, SECRET).signature).toBe(signed.signature);
    expect(signMandate(DEMO_MANDATE, OTHER_SECRET).signature).not.toBe(signed.signature);
  });

  it("verifies a good record", () => {
    expect(verifySignedMandate(signed)).toBe(true);
  });

  it("verifies after a JSON round trip (as when stored in a database)", () => {
    expect(verifySignedMandate(JSON.parse(JSON.stringify(signed)) as SignedMandate)).toBe(true);
  });

  it("fails when any rule is edited", () => {
    const edits: ((m: IntentMandate) => void)[] = [
      (m) => (m.allowance_rules.weekly_budget_cents = 99999),
      (m) => (m.allowance_rules.ask_first_unit_price_cents = null),
      (m) => (m.allowance_rules.never_categories = []),
      (m) => (m.allowance_rules.allowed_categories = ["cleaning", "paper_goods", "laundry", "kitchen", "gift_cards"]),
      (m) => (m.intent_expiry = "2099-12-31T23:59:59-06:00"),
      (m) => (m.natural_language_description = "Spend whatever."),
      (m) => (m.merchants = ["Somewhere else"]),
    ];
    for (const edit of edits) {
      const forged = clone(signed);
      edit(forged.mandate);
      expect(verifySignedMandate(forged)).toBe(false);
      // Even with the hash recomputed, the signature no longer matches.
      forged.hash = mandateHash(forged.mandate);
      expect(verifySignedMandate(forged)).toBe(false);
    }
  });

  it("fails when the hash, signature or public key is changed", () => {
    expect(verifySignedMandate({ ...signed, hash: "0".repeat(64) })).toBe(false);
    expect(verifySignedMandate({ ...signed, hash: signed.hash.toUpperCase() })).toBe(false);
    const flipped = (signed.signature[0] === "A" ? "B" : "A") + signed.signature.slice(1);
    expect(verifySignedMandate({ ...signed, signature: flipped })).toBe(false);
    const other = signMandate(DEMO_MANDATE, OTHER_SECRET);
    expect(verifySignedMandate({ ...signed, publicKey: other.publicKey })).toBe(false);
    expect(verifySignedMandate({ ...signed, signature: other.signature })).toBe(false);
  });

  it("checks out with a public key built a second way (JWK), not only our own key code", () => {
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(signed.publicKey, "base64").toString("base64url") },
      format: "jwk",
    });
    const bytes = Buffer.from(KNOWN_DEMO_CANONICAL, "utf8");
    expect(nodeVerify(null, bytes, publicKey, Buffer.from(signed.signature, "base64"))).toBe(true);
    expect(nodeVerify(null, Buffer.from(KNOWN_DEMO_CANONICAL + " ", "utf8"), publicKey, Buffer.from(signed.signature, "base64"))).toBe(false);
  });

  it("never throws on garbage and returns false", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      "text",
      [],
      {},
      { mandate: DEMO_MANDATE },
      { ...signed, mandate: undefined },
      { ...signed, mandate: { fn: () => 1 } },
      { ...signed, hash: 5 },
      { ...signed, hash: null },
      { ...signed, signature: 5 },
      { ...signed, signature: "" },
      { ...signed, signature: "not base64 !!!" },
      { ...signed, signature: signed.signature.slice(0, -4) },
      { ...signed, publicKey: undefined },
      { ...signed, publicKey: "" },
      { ...signed, publicKey: "AAAA" },
      { ...signed, publicKey: signed.publicKey.replace(/=+$/, "") },
      { ...signed, publicKey: Buffer.alloc(32).toString("base64") },
    ];
    for (const g of garbage) {
      expect(() => verifySignedMandate(g as SignedMandate)).not.toThrow();
      expect(verifySignedMandate(g as SignedMandate)).toBe(false);
    }
  });

  it("refuses to sign with a short secret", () => {
    expect(() => signMandate(DEMO_MANDATE, "short")).toThrow();
  });

  it("refuses to sign a value that is not plain JSON", () => {
    const bad = { ...clone(DEMO_MANDATE), intent_expiry: new Date(0) } as unknown as IntentMandate;
    expect(() => signMandate(bad, SECRET)).toThrow();
  });

  it("has a known canonical text, hash and signature for the demo mandate so the format cannot drift", () => {
    expect(canonicalJson(DEMO_MANDATE)).toBe(KNOWN_DEMO_CANONICAL);
    expect(signed.hash).toBe(createHash("sha256").update(KNOWN_DEMO_CANONICAL).digest("hex"));
    expect(signed.signature).toBe(KNOWN_DEMO_SIGNATURE);
  });
});

// Pinned values: if these change, every mandate already stored stops verifying.
// The canonical text is written out by hand (keys in code-unit order), not copied from the code.
const KNOWN_DEMO_CANONICAL =
  '{"allowance_rules":{"allowed_categories":["cleaning","paper_goods","laundry","kitchen"],' +
  '"ask_first_unit_price_cents":4000,"never_categories":["gift_cards"],"weekly_budget_cents":12000},' +
  '"intent_expiry":"2026-12-31T23:59:59-06:00","merchants":["Allowance demo store"],' +
  '"natural_language_description":"$120 a week, household basics only, nothing over $40 without asking me, never gift cards.",' +
  '"not_enforced":[],"requires_refundability":false,"skus":null,"type":"IntentMandate",' +
  '"user_cart_confirmation_required":false}';
const KNOWN_DEMO_SIGNATURE =
  "dXnLna5nWfS+dtIi9wi8znybpcMUETewE7RQwugIuZtr+Fo00JZ1BAztt+/Xro6Wh98gtp7Gdlq9GBWGrammAA==";
