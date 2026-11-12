// Starts a run and streams its steps as they are stored (KTD10), one JSON object per line.
import { getAgent } from "@/lib/agent";
import { CANNOT_CHECK } from "@/lib/checkout/checkout";
import { getDb } from "@/lib/db";
import { aiBudgetState, costMicroUsd, recordAiSpend } from "@/lib/limits/ai-budget";
import { CAPS, HOUR_MS, addressKey, clientAddress, runInProgress, takeFromCounter } from "@/lib/limits/limits";
import { forbidden, isSameOrigin, shouldUseSecureCookies } from "@/lib/http";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { getPayPal, now } from "@/lib/ports";
import { getSecret } from "@/lib/secrets";
import { type RunKind, MAX_LINE_CHARS, createRun, executeRun } from "@/lib/runs/run";
import { resolveVisitor } from "@/lib/visitor/request";

const KINDS: RunKind[] = ["agent", "restock", "ask_first", "skip"];

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => null)) as { kind?: string; hiddenLine?: unknown } | null;
  const kind = KINDS.find((k) => k === body?.kind);
  if (!kind) return Response.json({ error: "Unknown run kind." }, { status: 400 });
  const line = typeof body?.hiddenLine === "string" ? body.hiddenLine.trim() : "";
  if (line.length > MAX_LINE_CHARS) {
    return Response.json({ error: `Your line is ${line.length} characters. The limit is ${MAX_LINE_CHARS}.` }, { status: 400 });
  }
  if ((kind === "agent" || kind === "skip") && line.length === 0) {
    return Response.json({ error: "Type a hidden line first." }, { status: 400 });
  }

  const signingSecret = getSecret("MANDATE_SIGNING_KEY");
  if (!signingSecret) return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  const at = now();
  const addr = addressKey(clientAddress(request), signingSecret, at);

  // The address cap comes first, so requests without a cookie cannot create ledgers without limit.
  let db;
  try {
    db = await getDb();
    const allowed = await db.transaction((tx) =>
      takeFromCounter(tx, `checkout:addr:${addr}`, CAPS.addressCheckouts, HOUR_MS, at),
    );
    if (!allowed) return Response.json({ cap: true, error: "You have used today's live tries." }, { status: 429 });
  } catch {
    return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  }

  let visitor;
  try {
    visitor = await resolveVisitor(request, shouldUseSecureCookies(request));
  } catch {
    return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  }

  // Caps (R22): one run at a time, checkout actions per address, and for AI runs the visitor
  // and address caps and the AI budget. A counter that cannot be read fails closed (R15).
  // The run row is created inside the same transaction, so two clicks cannot both pass.
  const req = { ledgerId: visitor.ledgerId, kind, hiddenLine: kind === "agent" || kind === "skip" ? line : null };
  let gate: { ok: true; runId: string } | { ok: false; why: "busy" | "cap" | "budget" };
  try {
    gate = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [visitor.ledgerId]);
      const refuse = (why: "busy" | "cap" | "budget") => ({ ok: false as const, why });
      if (await runInProgress(tx, visitor.ledgerId, at)) return refuse("busy");
      if (kind !== "skip") {
        if (!(await aiBudgetState(tx, at)).open) return refuse("budget");
        if (!(await takeFromCounter(tx, `run:ledger:${visitor.ledgerId}`, CAPS.visitorRuns, HOUR_MS, at))) return refuse("cap");
        if (!(await takeFromCounter(tx, `run:addr:${addr}`, CAPS.addressRuns, HOUR_MS, at))) return refuse("cap");
      }
      return { ok: true as const, runId: await createRun(tx, req, at) };
    });
  } catch {
    return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  }
  if (!gate.ok && gate.why === "busy") {
    return Response.json({ error: "A run is already in progress. Wait for it to finish." }, { status: 429 });
  }
  if (!gate.ok) {
    const res = Response.json({ cap: true, error: "You have used today's live tries." }, { status: 429 });
    if (visitor.setCookie) res.headers.append("Set-Cookie", visitor.setCookie);
    return res;
  }

  const runId = gate.runId;
  const agent = await getAgent();
  const expectedPublicKey = deriveSigningKey(visitor.signingSecret).publicKeyBase64;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "start", runId });
      try {
        const onUsage = async (u: { model: string; inputTokens: number; outputTokens: number }) => {
          const cost = costMicroUsd(u.model, u.inputTokens, u.outputTokens);
          await recordAiSpend(db, now(), cost);
          await db.query("UPDATE runs SET cost_microusd = cost_microusd + $2 WHERE id = $1", [runId, cost]);
        };
        const result = await executeRun(
          { db, paypal: getPayPal(), agent, now, expectedPublicKey, onUsage },
          runId,
          req,
          (step) => send({ type: "step", step }),
        );
        send({ type: "done", runId, card: result.card });
      } catch {
        send({
          type: "done",
          runId,
          card: {
            ending: "d",
            tone: "neutral",
            headline: CANNOT_CHECK,
            ai: "The run stopped.",
            rule: "Not checked.",
            paypal: "Nothing reached PayPal.",
            receiptId: null,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  if (visitor.setCookie) headers.append("Set-Cookie", visitor.setCookie);
  return new Response(stream, { headers });
}
