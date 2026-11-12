// The rule writer's two steps. "compile" reads a parent's English rule into a proposed mandate and
// signs nothing. "sign" checks the proposal again on the server and stores a NEW mandate version.
// Browser JSON is never trusted: the proposal is validated again, and "Not enforced" clauses must
// each have been accepted or removed.
import { getDb } from "@/lib/db";
import { forbidden, isSameOrigin, shouldUseSecureCookies } from "@/lib/http";
import { aiBudgetState, costMicroUsd, recordAiSpend } from "@/lib/limits/ai-budget";
import { CAPS, HOUR_MS, addressKey, clientAddress, takeFromCounter } from "@/lib/limits/limits";
import { buildMandate, finalizeForSigning, ruleTextProblem, runCompile } from "@/lib/mandate/compile";
import { getRuleCompiler } from "@/lib/mandate";
import { signMandate } from "@/lib/mandate/sign";
import { currentOwner } from "@/lib/owner/guard";
import { now } from "@/lib/ports";
import { getSecret } from "@/lib/secrets";
import { DEMO_LEDGER_ID, ensureDemoLedger, insertMandateVersion } from "@/lib/visitor/ledger";
import { type VisitorContext, resolveVisitor } from "@/lib/visitor/request";

type Target = "mine" | "demo";

const MAX_BODY_CHARS = 20_000;
const UNAVAILABLE = "The rule writer is not available right now. Nothing was changed.";
const UNREADABLE = "Could not read this rule";
const TRIES_USED = "You have used this hour's rule tries.";

function reply(body: unknown, status: number, cookie: string | null = null): Response {
  const res = Response.json(body, { status });
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
}

function budgetClosedMessage(reason: "daily" | "total" | "ended"): string {
  return reason === "ended"
    ? "The rule reader was turned off after December 15, 2026."
    : "The rule reader has reached its limit for today. Try again tomorrow.";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_CHARS) return reply({ error: "That request is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "That request could not be read." }, 400);
  }

  const target: Target | null = body.target === "mine" || body.target === "demo" ? body.target : null;
  if (!target) return reply({ error: "Choose whose rule this is." }, 400);
  const problem = ruleTextProblem(body.text);
  if (problem) return reply({ error: problem }, 400);
  const text = (body.text as string).trim();

  // Only the owner may touch the demo parent's rule. Checked before any AI call is paid for.
  if (target === "demo" && !(await currentOwner())) {
    return forbidden("Only the owner can change the demo parent's rule.");
  }

  if (body.action === "compile") return compile(request, text, target);
  if (body.action === "sign") return sign(request, text, target, body);
  return reply({ error: "Unknown action." }, 400);
}

async function compile(request: Request, text: string, target: Target): Promise<Response> {
  const secret = getSecret("MANDATE_SIGNING_KEY");
  if (!secret) return reply({ error: UNAVAILABLE }, 503);

  let visitor: VisitorContext | null = null;
  try {
    if (target === "mine") visitor = await resolveVisitor(request, shouldUseSecureCookies(request));
  } catch {
    return reply({ error: UNAVAILABLE }, 503);
  }
  // Once a visitor ledger exists, every answer carries its cookie, or the next call would start a second ledger.
  const cookie = visitor?.setCookie ?? null;

  try {
    const db = await getDb();
    const at = now();
    const ledgerId = visitor ? visitor.ledgerId : DEMO_LEDGER_ID;

    // Caps (R22): the AI budget, tries per visitor, and tries per address. The owner changing the
    // demo parent's rule has no per-visitor cap. A counter that cannot be read fails closed (503).
    const gate = await db.transaction(async (tx) => {
      if (target === "mine") await tx.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [ledgerId]);
      const budget = await aiBudgetState(tx, at);
      if (!budget.open) return { ok: false as const, error: budgetClosedMessage(budget.reason) };
      const address = addressKey(clientAddress(request), secret, at);
      if (target === "mine" && !(await takeFromCounter(tx, `compile:ledger:${ledgerId}`, CAPS.visitorCompiles, HOUR_MS, at))) {
        return { ok: false as const, error: TRIES_USED };
      }
      if (!(await takeFromCounter(tx, `compile:addr:${address}`, CAPS.addressCompiles, HOUR_MS, at))) {
        return { ok: false as const, error: TRIES_USED };
      }
      return { ok: true as const };
    });
    if (!gate.ok) return reply({ error: gate.error }, 429, cookie);

    const compiler = getRuleCompiler();
    const run = await runCompile(compiler, text);
    await recordAiSpend(db, now(), costMicroUsd(compiler.model, run.usage.inputTokens, run.usage.outputTokens));

    if (!run.compiled) return reply({ error: UNREADABLE }, 422, cookie);
    return reply({ text, compiled: run.compiled }, 200, cookie);
  } catch {
    return reply({ error: UNAVAILABLE }, 503, cookie);
  }
}

async function sign(request: Request, text: string, target: Target, body: Record<string, unknown>): Promise<Response> {
  // Everything is checked before a visitor ledger is touched, so a bad request creates nothing.
  const checked = finalizeForSigning(body.compiled, body.accepted);
  if (!checked.ok) return reply({ error: checked.error }, 400);

  const secret = getSecret("MANDATE_SIGNING_KEY");
  if (!secret) return reply({ error: UNAVAILABLE }, 503);

  let mandate;
  try {
    mandate = buildMandate(text, checked.compiled, now());
  } catch (error) {
    if (error instanceof RangeError) return reply({ error: "The demo has ended, so no new rule can be signed." }, 409);
    return reply({ error: "That rule could not be signed. Read it again." }, 400);
  }
  const signed = signMandate(mandate, secret);

  let cookie: string | null = null;
  try {
    let ledgerId = DEMO_LEDGER_ID;
    if (target === "mine") {
      const visitor = await resolveVisitor(request, shouldUseSecureCookies(request));
      ledgerId = visitor.ledgerId;
      cookie = visitor.setCookie;
    }
    const db = await getDb();
    const at = now();
    // The ledger row is locked so two signatures cannot take the same version number.
    const row = await db.transaction(async (tx) => {
      if (target === "demo") await ensureDemoLedger(tx, secret, at);
      await tx.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [ledgerId]);
      return insertMandateVersion(tx, ledgerId, signed, at);
    });
    return reply(
      {
        target,
        signed: { version: row.version, hash: row.hash, signature: row.signature, publicKey: row.public_key, mandate: signed.mandate },
      },
      200,
      cookie,
    );
  } catch {
    return reply({ error: UNAVAILABLE }, 503, cookie);
  }
}
