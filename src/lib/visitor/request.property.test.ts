// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VISITOR_COOKIE } from "./ledger";
import { readCookie } from "./request";

/** A request with this Cookie header. Every generator below yields only values Headers accepts. */
const withCookie = (cookie: string) => new Request("https://x.test/", { headers: { cookie } });
const read = (cookie: string) => readCookie(withCookie(cookie), VISITOR_COOKIE);

// Printable ASCII and Latin-1: the characters a header value may hold.
const headerChar = fc.integer({ min: 0x20, max: 0xff }).map((c) => String.fromCharCode(c));
const headerText = fc.string({ unit: headerChar, maxLength: 120 });

// Cookie pairs with a name that is never the visitor cookie's.
const otherPair = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/).filter((n) => n !== VISITOR_COOKIE), fc.string({ unit: "grapheme-ascii", maxLength: 20 }))
  .map(([name, value]) => `${name}=${value.replaceAll(";", "")}`);
const others = fc.array(otherPair, { maxLength: 4 });

describe("readCookie properties", () => {
  it("returns a string or undefined and never throws, for any cookie header", () => {
    fc.assert(
      fc.property(headerText, (cookie) => {
        const request = withCookie(cookie);
        let value: string | undefined;
        expect(() => {
          value = readCookie(request, VISITOR_COOKIE);
        }).not.toThrow();
        expect(value === undefined || typeof value === "string").toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("never throws when the visitor cookie is present with any value", () => {
    fc.assert(
      fc.property(others, headerText.map((v) => v.replaceAll(";", "")), others, (before, value, after) => {
        const request = withCookie([...before, `${VISITOR_COOKIE}=${value}`, ...after].join("; "));
        let found: string | undefined;
        expect(() => {
          found = readCookie(request, VISITOR_COOKIE);
        }).not.toThrow();
        expect(found === undefined || typeof found === "string").toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("reads back any encoded value from among other cookies", () => {
    fc.assert(
      fc.property(others, fc.string({ unit: "grapheme", maxLength: 40 }), others, (before, value, after) => {
        const cookie = [...before, `${VISITOR_COOKIE}=${encodeURIComponent(value)}`, ...after].join("; ");
        expect(read(cookie)).toBe(value);
      }),
      { numRuns: 1000 },
    );
  });

  it("returns undefined for a value that is not valid percent-encoding", () => {
    const malformed = fc.constantFrom("%", "%zz", "%g1", "%1g", "%E0%A4%A", "%FF", "%C0%80", "100%", "50% off", "abc%");
    fc.assert(
      fc.property(others, malformed, others, (before, value, after) => {
        expect(read([...before, `${VISITOR_COOKIE}=${value}`, ...after].join("; "))).toBeUndefined();
      }),
      { numRuns: 1000 },
    );
  });

  it("returns undefined when only other cookies are present", () => {
    fc.assert(
      fc.property(others, (pairs) => {
        expect(read(pairs.join("; "))).toBeUndefined();
      }),
      { numRuns: 1000 },
    );
  });

  it("returns undefined when there is no Cookie header at all", () => {
    expect(readCookie(new Request("https://x.test/"), VISITOR_COOKIE)).toBeUndefined();
  });
});
