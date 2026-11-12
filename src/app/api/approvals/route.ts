// The parent's Approve or Decline on an ask-first request (R24). On the public page the visitor
// plays the parent for their own run; another visitor's cookie finds nothing to approve.
import { decideApproval } from "@/lib/checkout/approvals";
import { CANNOT_CHECK } from "@/lib/checkout/checkout";
import { getDb } from "@/lib/db";
import { forbidden, isSameOrigin } from "@/lib/http";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { getPayPal, now } from "@/lib/ports";
import { decisionCard } from "@/lib/runs/card";
import { getSecret } from "@/lib/secrets";
import { VISITOR_COOKIE, findVisitorLedgerId } from "@/lib/visitor/ledger";
import { readCookie } from "@/lib/visitor/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => null)) as { attemptId?: unknown; decision?: unknown } | null;
  const decision = body?.decision === "approve" || body?.decision === "decline" ? body.decision : null;
  const attemptId = typeof body?.attemptId === "string" && /^[0-9a-f-]{36}$/.test(body.attemptId) ? body.attemptId : null;
  if (!decision || !attemptId) return Response.json({ error: "Unknown request." }, { status: 400 });
  const cookie = readCookie(request, VISITOR_COOKIE);
  const secret = getSecret("MANDATE_SIGNING_KEY");
  if (!cookie || !secret) return Response.json({ error: "This request was not found." }, { status: 404 });
  try {
    const db = await getDb();
    const ledgerId = await findVisitorLedgerId(db, cookie);
    if (!ledgerId) return Response.json({ error: "This request was not found." }, { status: 404 });
    const result = await decideApproval(
      db,
      getPayPal(),
      { attemptId, ledgerId, decision, expectedPublicKey: deriveSigningKey(secret).publicKeyBase64 },
      now(),
    );
    if (result.error === "not_found") return Response.json({ error: result.message }, { status: 404 });
    if (!result.attempt) return Response.json({ error: result.message }, { status: 503 });
    return Response.json({ card: decisionCard(result.attempt) });
  } catch {
    return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  }
}
