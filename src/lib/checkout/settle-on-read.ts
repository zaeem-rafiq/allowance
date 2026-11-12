// Settles a visitor's open charges when they next load a page or start a run (plan U5).
import type { Db } from "@/lib/db";
import { getPayPal, now } from "@/lib/ports";
import { findVisitorLedgerId } from "@/lib/visitor/ledger";
import { settleOpenAttempts } from "./checkout";

/** Best effort: never throws, so a PayPal or database hiccup cannot break the page that called it. */
export async function settleForVisitor(db: Db, cookie: string | undefined): Promise<void> {
  if (!cookie) return;
  try {
    const ledgerId = await findVisitorLedgerId(db, cookie);
    if (ledgerId) await settleOpenAttempts(db, getPayPal(), ledgerId, now());
  } catch {
    // The attempt stays open and its amount held; the next read tries again.
  }
}

export async function settleForLedger(db: Db, ledgerId: string): Promise<void> {
  try {
    await settleOpenAttempts(db, getPayPal(), ledgerId, now());
  } catch {
    // As above.
  }
}
