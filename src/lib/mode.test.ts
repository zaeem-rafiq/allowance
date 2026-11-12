// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertModeAllowed, isTestMode } from "./mode";

describe("test mode switch", () => {
  it("is on only for the exact value 1", () => {
    expect(isTestMode({ ALLOWANCE_TEST_MODE: "1" })).toBe(true);
    expect(isTestMode({ ALLOWANCE_TEST_MODE: "true" })).toBe(false);
    expect(isTestMode({})).toBe(false);
  });

  it("refuses to start in a production build and names the variable", () => {
    expect(() => assertModeAllowed({ ALLOWANCE_TEST_MODE: "1", NODE_ENV: "production" })).toThrow(
      /ALLOWANCE_TEST_MODE/,
    );
    expect(() => isTestMode({ ALLOWANCE_TEST_MODE: "1", NODE_ENV: "production" })).toThrow(/ALLOWANCE_TEST_MODE/);
    expect(isTestMode({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows test mode in development and in tests", () => {
    expect(() => assertModeAllowed({ ALLOWANCE_TEST_MODE: "1", NODE_ENV: "development" })).not.toThrow();
    expect(() => assertModeAllowed({ ALLOWANCE_TEST_MODE: "1", NODE_ENV: "test" })).not.toThrow();
  });
});
