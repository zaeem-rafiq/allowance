// Port bindings (KTD5). Test mode binds the fakes; otherwise the real adapters. Bound once per
// server process and kept on globalThis so development reloads reuse them.
import { assertModeAllowed, isTestMode } from "@/lib/mode";
import { PayPalSandboxClient } from "@/lib/paypal/client";
import { FakePayPal } from "@/lib/paypal/fake";
import type { PayPalPort } from "@/lib/paypal/port";

interface Bound {
  paypal?: PayPalPort;
  fakePayPal?: FakePayPal;
  fixedNow?: number | null;
}

const bound = ((globalThis as Record<string, unknown>).__allowancePorts ??= {}) as Bound;

export function getPayPal(): PayPalPort {
  assertModeAllowed();
  if (isTestMode()) return getFakePayPal();
  if (!bound.paypal) {
    bound.paypal = new PayPalSandboxClient(process.env.PAYPAL_CLIENT_ID ?? "", process.env.PAYPAL_CLIENT_SECRET ?? "");
  }
  return bound.paypal;
}

/** Test mode only. */
export function getFakePayPal(): FakePayPal {
  if (!isTestMode()) throw new Error("The fake PayPal exists only in test mode.");
  bound.fakePayPal ??= new FakePayPal();
  return bound.fakePayPal;
}

/** The current time. Test mode can set it; elsewhere it is the real clock. */
export function now(): Date {
  if (isTestMode() && typeof bound.fixedNow === "number") return new Date(bound.fixedNow);
  return new Date();
}

/** Test mode only: set the clock to a fixed time, or null for the real clock. */
export function setTestClock(at: Date | null): void {
  if (!isTestMode()) throw new Error("The clock can be set only in test mode.");
  bound.fixedNow = at ? at.getTime() : null;
}
