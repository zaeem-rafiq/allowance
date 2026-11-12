// Builds the evidence for one dispute (R26): the signed mandate, the cart and the agent's steps
// from the one attempt the disputed capture belongs to. It reads only that attempt, the
// mandate version the attempt was checked against, and that attempt's own run. It never reads
// settings (the saved PayPal token), cookies, visitor keys, the run's hidden line, or any other
// visitor's rows.
import type { AttemptRow } from "@/lib/checkout/checkout";
import type { Queryable } from "@/lib/db";
import { formatUsd } from "@/lib/money/cents";
import { MAX_NOTES_CHARS, type EvidenceInput, asciiOnly } from "@/lib/paypal/disputes";

interface MandateVersionEvidence {
  version: number;
  hash: string;
  signature: string;
  public_key: string;
  mandate: unknown;
  created_at: Date | string;
}

interface StepEvidence {
  seq: number;
  kind: string;
  text: string;
  at: string;
}

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cartLines(attempt: AttemptRow): CartLine[] {
  const verdict = attempt.verdict as { lines?: CartLine[] };
  return Array.isArray(verdict.lines) ? verdict.lines : [];
}

const SUFFIX = (omitted: number) => ` ... ${omitted} more recorded steps are in the attached document.`;

/** The notes field: complete on its own, in case the uploaded file is not accepted. At most 2,000 characters. */
export function buildNotes(input: {
  captureId: string;
  amountCents: number;
  mandate: { version: number; hash: string; signature: string; publicKey: string };
  rule: string;
  cart: CartLine[];
  totalCents: number;
  steps: string[];
}): string {
  const { mandate } = input;
  const head = [
    `Allowance evidence for PayPal capture ${input.captureId} (${formatUsd(input.amountCents)}).`,
    `A signed spending rule (the mandate) checked this cart before PayPal was charged: ${input.rule.slice(0, 200)}.`,
    `Mandate version ${mandate.version}. SHA-256 hash ${mandate.hash}. Ed25519 signature (base64) ${mandate.signature}. Public key (base64) ${mandate.publicKey}.`,
    `Cart: ${input.cart.map((l) => `${l.quantity} x ${l.name} (${formatUsd(l.lineTotalCents)})`).join("; ") || "none"}. Total ${formatUsd(input.totalCents)}.`,
  ].join("\n");
  const stepsHead = `\nAgent steps (${input.steps.length}):`;
  let notes = head + stepsHead;
  let used = 0;
  for (const [i, step] of input.steps.entries()) {
    const line = `\n${i + 1}. ${step}`;
    const remaining = input.steps.length - i - 1;
    // Keep room for the closing sentence while steps are left over.
    const closing = remaining > 0 ? `\n${SUFFIX(remaining).trim()}` : "";
    if (notes.length + line.length + closing.length > MAX_NOTES_CHARS) break;
    notes += line;
    used++;
  }
  if (used < input.steps.length) notes += `\n${SUFFIX(input.steps.length - used).trim()}`;
  return asciiOnly(notes).slice(0, MAX_NOTES_CHARS);
}

/** Returns null when the attempt, or its mandate version, is not in the database. */
export async function buildEvidence(q: Queryable, attemptId: string, disputeId: string, preparedAt: Date): Promise<EvidenceInput | null> {
  const attempts = await q.query<AttemptRow>("SELECT * FROM attempts WHERE id = $1", [attemptId]);
  const attempt = attempts[0];
  if (!attempt || !attempt.paypal) return null;
  const versions = await q.query<MandateVersionEvidence>(
    "SELECT version, hash, signature, public_key, mandate, created_at FROM mandate_versions WHERE id = $1",
    [attempt.mandate_version_id],
  );
  const mv = versions[0];
  if (!mv) return null;
  const steps = attempt.run_id
    ? (
        await q.query<{ seq: number; kind: string; text: string | null; created_at: Date | string }>(
          "SELECT seq, kind, detail->>'text' AS text, created_at FROM run_steps WHERE run_id = $1 ORDER BY seq",
          [attempt.run_id],
        )
      ).map<StepEvidence>((s) => ({ seq: s.seq, kind: s.kind, text: s.text ?? "", at: iso(s.created_at) ?? "" }))
    : [];
  const cart = cartLines(attempt);

  const record = {
    kind: "allowance-dispute-evidence",
    dispute_id: disputeId,
    prepared_at: preparedAt.toISOString(),
    charge: {
      paypal_capture_id: attempt.paypal.captureId,
      paypal_order_id: attempt.paypal.orderId,
      amount_cents: attempt.paypal.amountCents,
      captured_at: attempt.paypal.at,
      started_by: attempt.source,
    },
    mandate: {
      version: mv.version,
      hash_sha256: mv.hash,
      signature_ed25519_base64: mv.signature,
      public_key_base64: mv.public_key,
      how_to_check:
        "The hash is the SHA-256 of the canonical JSON of `content` (keys sorted, no whitespace). The signature is an Ed25519 signature over those same bytes.",
      content: mv.mandate,
      signed_at: iso(mv.created_at),
    },
    rule_check: { decision: (attempt.verdict as { decision?: string }).decision ?? null, rule: attempt.rule, total_cents: attempt.total_cents },
    cart: cart.map((l) => ({
      product_id: l.productId,
      name: l.name,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      line_total_cents: l.lineTotalCents,
    })),
    agent_steps: steps,
  };

  const notes = buildNotes({
    captureId: attempt.paypal.captureId,
    amountCents: attempt.paypal.amountCents,
    mandate: { version: mv.version, hash: mv.hash, signature: mv.signature, publicKey: mv.public_key },
    rule: attempt.rule,
    cart,
    totalCents: attempt.total_cents,
    steps: steps.map((s) => s.text),
  });
  return { notes, document: { name: "allowance-evidence.pdf", json: JSON.stringify(record, null, 2) } };
}
