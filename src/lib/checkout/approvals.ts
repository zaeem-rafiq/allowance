// Ask-first approvals (R24). An item over the ask-first limit waits for the parent. Approval runs
// the full check again and works once; decline and expiry charge $0 and release the amount.
import { type Verdict, checkCart } from "@/lib/checker/check-cart";
import type { Db } from "@/lib/db";
import { verifySignedMandate } from "@/lib/mandate/sign";
import type { PayPalPort } from "@/lib/paypal/port";
import { SAVED_PAYPAL_KEY, getSetting } from "@/lib/settings";
import { currentMandate } from "@/lib/visitor/ledger";
import { APPROVAL_TTL_MS, type AttemptRow, CANNOT_CHECK, applyChargeResult, ledgerSpend } from "./checkout";

export type Decision = "approve" | "decline";

export interface DecisionResult {
  attempt: AttemptRow | null;
  error: "not_found" | "cannot_check" | null;
  message: string;
}

export async function decideApproval(
  db: Db,
  paypal: PayPalPort,
  input: { attemptId: string; ledgerId: string; decision: Decision; expectedPublicKey: string },
  now: Date,
): Promise<DecisionResult> {
  let toCharge: { attempt: AttemptRow; vaultId: string } | null = null;
  let result: AttemptRow | null;
  try {
    result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [input.ledgerId]);
      const rows = await tx.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1 AND ledger_id = $2 FOR UPDATE", [
        input.attemptId,
        input.ledgerId,
      ]);
      const attempt = rows[0];
      if (!attempt) return null;
      // A second tap, or a tap after it settled, returns the result it already has.
      if (attempt.state !== "pending") return attempt;

      const update = async (state: string, message: string) =>
        (
          await tx.query<AttemptRow>(
            "UPDATE attempts SET state = $2, reserved_cents = 0, message = $3, settled_at = $4 WHERE id = $1 RETURNING *",
            [attempt.id, state, message, now.toISOString()],
          )
        )[0];

      if (now.getTime() - new Date(attempt.created_at).getTime() >= APPROVAL_TTL_MS) {
        return update("expired", "This request expired after 10 minutes, so nothing was charged.");
      }
      if (input.decision === "decline") {
        return update("declined", "You declined. PayPal charged $0.");
      }

      // Approve: the full check runs again, without this request's own held amount.
      const mv = await currentMandate(tx, input.ledgerId);
      if (!mv) throw new Error("no mandate");
      const signedOk = verifySignedMandate({ mandate: mv.mandate, hash: mv.hash, signature: mv.signature, publicKey: mv.public_key });
      if (!signedOk || mv.public_key !== input.expectedPublicKey) throw new Error("mandate signature does not verify");
      const { spentCents, pendingCents } = await ledgerSpend(tx, input.ledgerId, now);
      const previous = attempt.verdict as Extract<Verdict, { decision: "needs_approval" }>;
      const cart = previous.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
      const verdict = checkCart({
        mandate: mv.mandate,
        cart,
        spentCents,
        pendingCents: Math.max(0, pendingCents - attempt.reserved_cents),
        now,
      });
      if (verdict.decision === "block") {
        const rows2 = await tx.query<AttemptRow>(
          `UPDATE attempts SET state = 'blocked', reserved_cents = 0, verdict = $2::jsonb, rule = $3, message = $4, settled_at = $5
           WHERE id = $1 RETURNING *`,
          [attempt.id, JSON.stringify(verdict), verdict.rule, `Blocked by your rule: ${verdict.rule}. ${verdict.code === "over_budget" ? verdict.reason + " " : ""}PayPal charged $0.`, now.toISOString()],
        );
        return rows2[0];
      }
      // The parent approved exactly this cart, so the ask-first line is satisfied.
      const allowed = {
        decision: "allow" as const,
        totalCents: verdict.totalCents,
        lines: verdict.lines,
        rule: "approved by you",
        remainingAfterCents: 0,
      };
      const saved = await getSetting<{ paymentTokenId: string }>(tx, SAVED_PAYPAL_KEY);
      if (!saved) {
        return (
          await tx.query<AttemptRow>(
            `UPDATE attempts SET state = 'allowed_not_charged', reserved_cents = 0, verdict = $2::jsonb, rule = $3, message = $4, settled_at = $5
             WHERE id = $1 RETURNING *`,
            [attempt.id, JSON.stringify(allowed), allowed.rule, "You approved it, but no PayPal account is saved yet, so nothing was charged.", now.toISOString()],
          )
        )[0];
      }
      const reserved = (
        await tx.query<AttemptRow>(
          `UPDATE attempts SET state = 'reserved', verdict = $2::jsonb, rule = $3, message = 'Checking with PayPal'
           WHERE id = $1 RETURNING *`,
          [attempt.id, JSON.stringify(allowed), allowed.rule],
        )
      )[0];
      toCharge = { attempt: reserved, vaultId: saved.paymentTokenId };
      return reserved;
    });
  } catch {
    return { attempt: null, error: "cannot_check", message: CANNOT_CHECK };
  }
  if (!result) return { attempt: null, error: "not_found", message: "This request was not found." };
  if (toCharge) {
    const { attempt, vaultId } = toCharge as { attempt: AttemptRow; vaultId: string };
    const verdict = attempt.verdict as Extract<Verdict, { decision: "allow" }>;
    const charge = await paypal.charge({
      vaultId,
      requestId: attempt.id,
      items: verdict.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitCents: l.unitPriceCents })),
      description: "Allowance demo store restock, approved by the parent",
    });
    result = await applyChargeResult(db, attempt, charge, now);
  }
  return { attempt: result, error: null, message: result.message ?? "" };
}
