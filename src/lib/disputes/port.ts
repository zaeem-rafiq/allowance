// Binds the disputes port (KTD5): the fake in test mode, PayPal's sandbox otherwise. Kept in
// this unit's own file so the shared port bindings in src/lib/ports.ts stay untouched.
import { assertModeAllowed, isTestMode } from "@/lib/mode";
import { PayPalSandboxClient } from "@/lib/paypal/client";
import { type DisputesPort, SandboxDisputes } from "@/lib/paypal/disputes";
import { FakeDisputes } from "@/lib/paypal/disputes-fake";

const bound = ((globalThis as Record<string, unknown>).__allowanceDisputesPort ??= {}) as { port?: DisputesPort };

export function getDisputesPort(): DisputesPort {
  assertModeAllowed();
  if (isTestMode()) return new FakeDisputes();
  if (!bound.port) {
    bound.port = new SandboxDisputes(new PayPalSandboxClient(process.env.PAYPAL_CLIENT_ID ?? "", process.env.PAYPAL_CLIENT_SECRET ?? ""));
  }
  return bound.port;
}
