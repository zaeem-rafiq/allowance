// @vitest-environment node
import { describe, expect, it } from "vitest";
import { centsToPayPal, formatUsd, payPalToCents } from "./cents";

describe("centsToPayPal", () => {
  it("writes two decimals", () => {
    expect(centsToPayPal(3400)).toBe("34.00");
    expect(centsToPayPal(5)).toBe("0.05");
    expect(centsToPayPal(0)).toBe("0.00");
    expect(centsToPayPal(123450)).toBe("1234.50");
    expect(centsToPayPal(99)).toBe("0.99");
  });

  it("throws on non-integer, negative or non-number input", () => {
    expect(() => centsToPayPal(1.5)).toThrow();
    expect(() => centsToPayPal(-1)).toThrow();
    expect(() => centsToPayPal(Number.NaN)).toThrow();
    expect(() => centsToPayPal(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => centsToPayPal("100" as unknown as number)).toThrow();
  });
});

describe("payPalToCents", () => {
  it("reads two-decimal strings", () => {
    expect(payPalToCents("34.00")).toBe(3400);
    expect(payPalToCents("0.05")).toBe(5);
    expect(payPalToCents("1234.50")).toBe(123450);
    expect(payPalToCents("0.00")).toBe(0);
  });

  it("throws on malformed input", () => {
    for (const bad of [
      "34",
      "34.5",
      "34.000",
      "-1.00",
      "1,000.00",
      " 1.00",
      "1.00 ",
      "$1.00",
      "",
      "abc",
      ".50",
      "1e3.00",
    ]) {
      expect(() => payPalToCents(bad), bad).toThrow();
    }
    expect(() => payPalToCents(undefined as unknown as string)).toThrow();
  });
});

describe("formatUsd", () => {
  it("drops the cents when the amount is whole dollars", () => {
    expect(formatUsd(3400)).toBe("$34");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(12000)).toBe("$120");
  });

  it("shows two decimals otherwise", () => {
    expect(formatUsd(3450)).toBe("$34.50");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(2001)).toBe("$20.01");
  });

  it("adds thousands separators", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
  });

  it("throws on negative or non-integer cents", () => {
    expect(() => formatUsd(-100)).toThrow();
    expect(() => formatUsd(0.5)).toThrow();
  });
});
