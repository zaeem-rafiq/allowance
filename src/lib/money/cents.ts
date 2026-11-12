/**
 * Money is integer cents everywhere. These helpers convert to and from the
 * two-decimal strings PayPal uses ("34.00") and to the short form shown to
 * people ("$34", "$34.50"). No floating point maths is used on money.
 */

function assertCents(cents: number): void {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("Cents must be a non-negative whole number.");
  }
}

/** 3400 -> "34.00", 5 -> "0.05", 123450 -> "1234.50". */
export function centsToPayPal(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${dollars}.${rest.toString().padStart(2, "0")}`;
}

/** "34.00" -> 3400. Accepts only digits, a dot and exactly two decimals. */
export function payPalToCents(value: string): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    throw new SyntaxError("A PayPal amount looks like 34.00.");
  }
  const [dollars, rest] = value.split(".");
  const cents = Number(dollars) * 100 + Number(rest);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("That amount is too large.");
  }
  return cents;
}

/** 3400 -> "$34", 3450 -> "$34.50". Negative amounts are not allowed. */
export function formatUsd(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = dollars.toLocaleString("en-US");
  return rest === 0 ? `$${whole}` : `$${whole}.${rest.toString().padStart(2, "0")}`;
}
