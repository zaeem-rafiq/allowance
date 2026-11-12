// Shared setup for checkout tests: a fresh in-memory database, the demo mandate, one visitor
// ledger, a saved PayPal reference and the counting fake PayPal.
import { createPglite, migrate, type Db } from "@/lib/db";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { TEST_SECRETS } from "@/lib/mode";
import { FakePayPal } from "@/lib/paypal/fake";
import { SAVED_PAYPAL_KEY, setSetting } from "@/lib/settings";
import { getOrCreateVisitorLedger } from "@/lib/visitor/ledger";

export const T0 = new Date("2026-11-11T21:00:00Z");
export const TEST_PUBLIC_KEY = deriveSigningKey(TEST_SECRETS.MANDATE_SIGNING_KEY).publicKeyBase64;

export async function freshCheckoutWorld(opts: { savedPayPal?: boolean } = {}) {
  const db: Db = await createPglite();
  await migrate(db);
  const paypal = new FakePayPal();
  const { ledgerId } = await getOrCreateVisitorLedger(db, undefined, TEST_SECRETS.MANDATE_SIGNING_KEY, T0);
  if (opts.savedPayPal !== false) {
    await setSetting(db, SAVED_PAYPAL_KEY, { paymentTokenId: "FAKE-VAULT", customerId: null, savedAt: T0.toISOString() });
  }
  return { db, paypal, ledgerId };
}

export const LIST_CART = [
  { productId: "paper-towels", quantity: 1 },
  { productId: "dish-soap", quantity: 1 },
  { productId: "laundry-detergent", quantity: 1 },
  { productId: "trash-bags", quantity: 1 },
  { productId: "sponges", quantity: 1 },
];
