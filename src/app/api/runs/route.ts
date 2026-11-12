// Starts a run and streams its steps as they are stored (KTD10), one JSON object per line.
import { getAgent } from "@/lib/agent";
import { CANNOT_CHECK } from "@/lib/checkout/checkout";
import { getDb } from "@/lib/db";
import { forbidden, isSameOrigin, shouldUseSecureCookies } from "@/lib/http";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { getPayPal, now } from "@/lib/ports";
import { type RunKind, MAX_LINE_CHARS, createRun, executeRun } from "@/lib/runs/run";
import { resolveVisitor } from "@/lib/visitor/request";

const KINDS: RunKind[] = ["agent", "restock", "skip"];

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  const body = (await request.json().catch(() => null)) as { kind?: string; hiddenLine?: unknown } | null;
  const kind = KINDS.find((k) => k === body?.kind);
  if (!kind) return Response.json({ error: "Unknown run kind." }, { status: 400 });
  const line = typeof body?.hiddenLine === "string" ? body.hiddenLine.trim() : "";
  if (line.length > MAX_LINE_CHARS) {
    return Response.json({ error: `Your line is ${line.length} characters. The limit is ${MAX_LINE_CHARS}.` }, { status: 400 });
  }
  if (kind !== "restock" && line.length === 0) {
    return Response.json({ error: "Type a hidden line first." }, { status: 400 });
  }

  let visitor;
  try {
    visitor = await resolveVisitor(request, shouldUseSecureCookies(request));
  } catch {
    return Response.json({ error: CANNOT_CHECK }, { status: 503 });
  }
  const db = await getDb();
  const req = { ledgerId: visitor.ledgerId, kind, hiddenLine: kind === "restock" ? null : line };
  const runId = await createRun(db, req, now());
  const agent = await getAgent();
  const expectedPublicKey = deriveSigningKey(visitor.signingSecret).publicKeyBase64;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "start", runId });
      try {
        const result = await executeRun({ db, paypal: getPayPal(), agent, now, expectedPublicKey }, runId, req, (step) =>
          send({ type: "step", step }),
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
