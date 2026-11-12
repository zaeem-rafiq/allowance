// Saving the owner's PayPal once (R18, KTD2). Start creates a setup token and remembers which
// owner session started it. Return accepts only that token from that session, exchanges it,
// and replaces the saved reference only after PayPal confirms the new one.
import { randomUUID } from "node:crypto";
import type { Queryable } from "@/lib/db";
import type { PayPalPort } from "@/lib/paypal/port";
import { SAVED_PAYPAL_KEY, getSetting, setSetting } from "@/lib/settings";
import type { OwnerSession } from "./session";

const PENDING_KEY = "paypal_save_pending";

export interface SavedPayPal {
  paymentTokenId: string;
  customerId: string | null;
  savedAt: string;
}

interface PendingSave {
  setupTokenId: string;
  nonce: string;
  startedAt: string;
}

export async function startSave(
  db: Queryable,
  paypal: PayPalPort,
  session: OwnerSession,
  origin: string,
  now: Date,
): Promise<string> {
  const res = await paypal.startSave({
    returnUrl: `${origin}/api/paypal/save/return`,
    cancelUrl: `${origin}/owner?paypal=cancelled`,
    requestId: randomUUID(),
  });
  const pending: PendingSave = { setupTokenId: res.setupTokenId, nonce: session.nonce, startedAt: now.toISOString() };
  await setSetting(db, PENDING_KEY, pending);
  return res.approveUrl;
}

export type FinishOutcome = "saved" | "refused" | "failed";

export async function finishSave(
  db: Queryable,
  paypal: PayPalPort,
  session: OwnerSession,
  setupTokenId: string | null,
  now: Date,
): Promise<FinishOutcome> {
  const pending = await getSetting<PendingSave>(db, PENDING_KEY);
  if (!pending || pending.nonce !== session.nonce) return "refused";
  // PayPal's return parameters are not stated in the saved docs. When a token comes back it must
  // match; when none does, the pending token this same owner session started is used.
  if (setupTokenId && pending.setupTokenId !== setupTokenId) return "refused";
  setupTokenId = pending.setupTokenId;
  try {
    const result = await paypal.finishSave({ setupTokenId, requestId: `save-${setupTokenId}` });
    const saved: SavedPayPal = { paymentTokenId: result.paymentTokenId, customerId: result.customerId, savedAt: now.toISOString() };
    await setSetting(db, SAVED_PAYPAL_KEY, saved);
    await db.query("DELETE FROM settings WHERE key = $1", [PENDING_KEY]);
    return "saved";
  } catch {
    return "failed";
  }
}

export async function getSavedPayPal(db: Queryable): Promise<SavedPayPal | null> {
  return getSetting<SavedPayPal>(db, SAVED_PAYPAL_KEY);
}
