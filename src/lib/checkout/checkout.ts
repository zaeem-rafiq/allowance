// The one checkout path for every charge (KTD1). It prices the cart from the server catalog,
// locks the ledger row, checks the rule and reserves the amount in one transaction, and calls
// PayPal only after that transaction commits. Every attempt ends in exactly one final state.
import { randomBytes } from "node:crypto";
import { type Verdict, checkCart, spendInWindow } from "@/lib/checker/check-cart";
import type { Db, Queryable } from "@/lib/db";
import { verifySignedMandate } from "@/lib/mandate/sign";
import { formatUsd } from "@/lib/money/cents";
import type { ChargeResult, PayPalPort } from "@/lib/paypal/port";
import { SAVED_PAYPAL_KEY, getSetting } from "@/lib/settings";
import { currentMandate } from "@/lib/visitor/ledger";

export type AttemptState =
  | "blocked"
  | "pending"
  | "declined"
  | "expired"
  | "reserved"
  | "captured"
  | "allowed_not_charged"
  | "unknown";

/** An ask-first request holds its amount for 10 minutes (R24). */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
export type AttemptSource = "agent" | "skip" | "restock" | "approval";

/** The shape of every receipt ID applyChargeResult issues (16 random bytes as base64url). */
export const RECEIPT_ID_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** The description PayPal shows for a restock charge. */
export const RESTOCK_DESCRIPTION = "Allowance demo store restock";

export const CANNOT_CHECK = "Allowance could not check your rule, so nothing was charged.";

export interface PayPalCopy {
  orderId: string;
  captureId: string;
  amountCents: number;
  at: string;
}

export interface AttemptRow {
  id: string;
  ledger_id: string;
  run_id: string | null;
  mandate_version_id: string;
  mandate_version: number;
  mandate_hash: string;
  source: AttemptSource;
  state: AttemptState;
  verdict: Verdict | { decision: "error" };
  rule: string;
  total_cents: number;
  reserved_cents: number;
  captured_cents: number;
  receipt_id: string | null;
  paypal: PayPalCopy | null;
  message: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface CheckoutResult {
  attempt: AttemptRow | null;
  /** Set when the check could not run at all (R15) or the run already checked out (R5). */
  error: "cannot_check" | "already_checked_out" | null;
  message: string;
}

interface SavedPayPal {
  paymentTokenId: string;
}

function blockMessage(v: Extract<Verdict, { decision: "block" }>): string {
  if (v.code === "over_budget") return `Blocked by your rule: ${v.rule}. ${v.reason} PayPal charged $0.`;
  if (v.code === "bad_input") return `Blocked: ${v.reason} PayPal charged $0.`;
  return `Blocked by your rule: ${v.rule}. PayPal charged $0.`;
}

function refusedMessage(reason: string): string {
  if (/VAULT|PAYMENT_SOURCE|TOKEN|INVALID_RESOURCE_ID|PAYER_ACTION_REQUIRED|AGREEMENT/.test(reason)) {
    return "PayPal did not accept the saved account, so nothing was charged.";
  }
  return "Your rule allowed this. PayPal's sandbox refused it, so nothing was charged.";
}

/** The ledger's current mandate, only if it is signed and signed by this server's own key. */
export async function loadVerifiedMandate(q: Queryable, ledgerId: string, expectedPublicKey: string) {
  const mv = await currentMandate(q, ledgerId);
  if (!mv) throw new Error("no mandate");
  const signedOk = verifySignedMandate({
    mandate: mv.mandate,
    hash: mv.hash,
    signature: mv.signature,
    publicKey: mv.public_key,
  });
  if (!signedOk || mv.public_key !== expectedPublicKey) throw new Error("mandate signature does not verify");
  return mv;
}

async function loadAttempt(q: Queryable, id: string): Promise<AttemptRow | null> {
  const rows = await q.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** Captured spend inside the rolling week, and amounts still reserved, for one ledger. */
export async function ledgerSpend(q: Queryable, ledgerId: string, now: Date): Promise<{ spentCents: number; pendingCents: number }> {
  const captured = await q.query<{ captured_cents: number; settled_at: string }>(
    "SELECT captured_cents, settled_at FROM attempts WHERE ledger_id = $1 AND state = 'captured' AND settled_at IS NOT NULL",
    [ledgerId],
  );
  const pending = await q.query<{ total: string | number | null }>(
    `SELECT coalesce(sum(reserved_cents), 0) AS total FROM attempts
     WHERE ledger_id = $1 AND (state IN ('reserved', 'unknown') OR (state = 'pending' AND created_at > $2))`,
    [ledgerId, new Date(now.getTime() - APPROVAL_TTL_MS).toISOString()],
  );
  return {
    spentCents: spendInWindow(
      captured.map((r) => ({ amountCents: Number(r.captured_cents), at: new Date(r.settled_at) })),
      now,
    ),
    pendingCents: Number(pending[0]?.total ?? 0),
  };
}

export interface CheckoutInput {
  attemptId: string;
  ledgerId: string;
  runId: string | null;
  source: AttemptSource;
  cart: unknown;
  /** The server's own mandate public key. A stored mandate signed by any other key is refused. */
  expectedPublicKey: string;
}

export async function checkout(db: Db, paypal: PayPalPort, input: CheckoutInput, now: Date): Promise<CheckoutResult> {
  // A repeat of the same attempt (a double click or a retry) returns the first result.
  try {
    const existing = await loadAttempt(db, input.attemptId);
    if (existing) {
      if (existing.ledger_id !== input.ledgerId) return { attempt: null, error: "cannot_check", message: CANNOT_CHECK };
      const settled = await settleIfUnknown(db, paypal, existing, now);
      return { attempt: settled, error: null, message: settled.message ?? "" };
    }
  } catch {
    return { attempt: null, error: "cannot_check", message: CANNOT_CHECK };
  }

  let attempt: AttemptRow;
  let vaultId: string | null = null;
  try {
    const outcome = await db.transaction(async (tx) => {
      const ledger = await tx.query<{ id: string }>("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [input.ledgerId]);
      if (!ledger[0]) throw new Error("ledger not found");
      if (input.runId) {
        const prior = await tx.query<{ id: string }>("SELECT id FROM attempts WHERE run_id = $1", [input.runId]);
        if (prior[0]) return { kind: "already" as const };
      }
      const mv = await loadVerifiedMandate(tx, input.ledgerId, input.expectedPublicKey);
      const { spentCents, pendingCents } = await ledgerSpend(tx, input.ledgerId, now);
      const verdict = checkCart({ mandate: mv.mandate, cart: input.cart, spentCents, pendingCents, now });
      const saved = await getSetting<SavedPayPal>(tx, SAVED_PAYPAL_KEY);

      let state: AttemptState;
      let message: string;
      let reserved = 0;
      if (verdict.decision === "block") {
        state = "blocked";
        message = blockMessage(verdict);
      } else if (verdict.decision === "needs_approval") {
        // R24: the amount is held while the parent decides, and nothing is charged until they approve.
        state = "pending";
        reserved = verdict.totalCents;
        const over = verdict.overLimit.map((l) => l.name).join(", ");
        message = `${over} costs more than your ask-first limit, so your AI is asking you first. Nothing is charged until you approve.`;
      } else if (!saved) {
        state = "allowed_not_charged";
        message = "Your rule allowed this, but no PayPal account is saved yet, so nothing was charged.";
      } else {
        state = "reserved";
        reserved = verdict.totalCents;
        message = "Checking with PayPal";
      }
      const rows = await tx.query<AttemptRow>(
        `INSERT INTO attempts (id, ledger_id, run_id, mandate_version_id, mandate_version, mandate_hash, source, state,
           verdict, rule, total_cents, reserved_cents, message, created_at, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [
          input.attemptId,
          input.ledgerId,
          input.runId,
          mv.id,
          mv.version,
          mv.hash,
          input.source,
          state,
          JSON.stringify(verdict),
          verdict.rule,
          verdict.totalCents,
          reserved,
          message,
          now.toISOString(),
          state === "reserved" || state === "pending" ? null : now.toISOString(),
        ],
      );
      return { kind: "ok" as const, attempt: rows[0], vaultId: saved?.paymentTokenId ?? null };
    });
    if (outcome.kind === "already") {
      return { attempt: null, error: "already_checked_out", message: "This run already checked out once." };
    }
    attempt = outcome.attempt;
    vaultId = outcome.vaultId;
  } catch {
    return { attempt: null, error: "cannot_check", message: CANNOT_CHECK };
  }

  if (attempt.state !== "reserved" || !vaultId) return { attempt, error: null, message: attempt.message ?? "" };

  // PayPal is called only after the reservation is committed.
  const finalAttempt = await chargeAttempt(db, paypal, attempt, vaultId, RESTOCK_DESCRIPTION, now);
  return { attempt: finalAttempt, error: null, message: finalAttempt.message ?? "" };
}

/** Charges a reserved attempt's cart with its own attempt ID as the request ID, then records the result. */
export async function chargeAttempt(
  db: Queryable,
  paypal: PayPalPort,
  attempt: AttemptRow,
  vaultId: string,
  description: string,
  now: Date,
): Promise<AttemptRow> {
  const verdict = attempt.verdict as Extract<Verdict, { decision: "allow" }>;
  const result = await paypal.charge({
    vaultId,
    requestId: attempt.id,
    items: verdict.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitCents: l.unitPriceCents })),
    description,
  });
  return applyChargeResult(db, attempt, result, now);
}

export async function applyChargeResult(db: Queryable, attempt: AttemptRow, result: ChargeResult, now: Date): Promise<AttemptRow> {
  if (result.status === "captured") {
    const copy: PayPalCopy = {
      orderId: result.orderId,
      captureId: result.captureId,
      amountCents: result.amountCents,
      at: result.at,
    };
    const receiptId = randomBytes(16).toString("base64url");
    const message = `Your rule allowed ${formatUsd(attempt.total_cents)}, and PayPal charged ${formatUsd(result.amountCents)}.`;
    const rows = await db.query<AttemptRow>(
      `UPDATE attempts SET state = 'captured', captured_cents = $2, reserved_cents = 0, receipt_id = coalesce(receipt_id, $3),
         paypal = $4::jsonb, message = $5, settled_at = $6
       WHERE id = $1 AND state IN ('reserved', 'unknown') RETURNING *`,
      [attempt.id, result.amountCents, receiptId, JSON.stringify(copy), message, now.toISOString()],
    );
    return rows[0] ?? ((await loadAttempt(db, attempt.id)) as AttemptRow);
  }
  if (result.status === "refused") {
    const rows = await db.query<AttemptRow>(
      `UPDATE attempts SET state = 'allowed_not_charged', reserved_cents = 0, message = $2, settled_at = $3
       WHERE id = $1 AND state IN ('reserved', 'unknown') RETURNING *`,
      [attempt.id, refusedMessage(result.reason), now.toISOString()],
    );
    return rows[0] ?? ((await loadAttempt(db, attempt.id)) as AttemptRow);
  }
  const rows = await db.query<AttemptRow>(
    `UPDATE attempts SET state = 'unknown', message = 'Checking with PayPal' WHERE id = $1 AND state IN ('reserved', 'unknown') RETURNING *`,
    [attempt.id],
  );
  return rows[0] ?? ((await loadAttempt(db, attempt.id)) as AttemptRow);
}

/** An unknown charge settles by repeating the same request ID; the reservation stays until then. */
export async function settleIfUnknown(db: Db, paypal: PayPalPort, attempt: AttemptRow, now: Date): Promise<AttemptRow> {
  if (attempt.state !== "unknown" && attempt.state !== "reserved") return attempt;
  const saved = await getSetting<SavedPayPal>(db, SAVED_PAYPAL_KEY);
  if (!saved) return attempt;
  return chargeAttempt(db, paypal, attempt, saved.paymentTokenId, RESTOCK_DESCRIPTION, now);
}

export async function findAttemptByReceipt(q: Queryable, receiptId: string): Promise<AttemptRow | null> {
  if (!RECEIPT_ID_SHAPE.test(receiptId)) return null;
  const rows = await q.query<AttemptRow>("SELECT * FROM attempts WHERE receipt_id = $1", [receiptId]);
  return rows[0] ?? null;
}
