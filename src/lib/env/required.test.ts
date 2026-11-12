// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOSTED_NAMES, OPTIONAL_NAMES, REQUIRED_NAMES, envReport } from "./required";

const allRequired = Object.fromEntries(REQUIRED_NAMES.map((n) => [n, "value-" + n]));

describe("envReport", () => {
  it("passes when every required name is set", () => {
    const report = envReport(allRequired);
    expect(report.ok).toBe(true);
    for (const name of REQUIRED_NAMES) expect(report.lines).toContain(`  ${name}: set`);
  });

  it("fails and names a required name that is empty", () => {
    const report = envReport({ ...allRequired, PAYPAL_CLIENT_SECRET: "" });
    expect(report.ok).toBe(false);
    expect(report.lines).toContain("  PAYPAL_CLIENT_SECRET: missing");
  });

  it("passes when only optional names are missing, and lists them", () => {
    const report = envReport(allRequired);
    expect(report.ok).toBe(true);
    for (const name of OPTIONAL_NAMES) expect(report.lines).toContain(`  ${name}: missing`);
  });

  it("requires the hosted names only in hosted mode", () => {
    expect(envReport(allRequired).ok).toBe(true);
    expect(envReport(allRequired, { hosted: true }).ok).toBe(false);
    const hosted = Object.fromEntries(HOSTED_NAMES.map((n) => [n, "v"]));
    expect(envReport({ ...allRequired, ...hosted }, { hosted: true }).ok).toBe(true);
  });

  it("never prints a value", () => {
    fc.assert(
      // Every generated value starts with "~", which no name or label contains.
      fc.property(fc.string({ minLength: 1, maxLength: 64 }).map((s) => "~" + s), (value) => {
        const env = Object.fromEntries(
          [...REQUIRED_NAMES, ...HOSTED_NAMES, ...OPTIONAL_NAMES].map((n) => [n, value]),
        );
        for (const hosted of [true, false]) {
          const out = envReport(env, { hosted }).lines.join("\n");
          expect(out.includes(value)).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
