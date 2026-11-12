// Resolves the visitor's ledger for a route handler, and the cookie to send back if it is new.
import { getDb } from "@/lib/db";
import { now } from "@/lib/ports";
import { getSecret } from "@/lib/secrets";
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE, getOrCreateVisitorLedger } from "./ledger";

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function visitorCookieHeader(value: string, secure: boolean): string {
  return `${VISITOR_COOKIE}=${value}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export interface VisitorContext {
  ledgerId: string;
  setCookie: string | null;
  signingSecret: string;
}

/** Throws when the database or the signing key is unavailable; callers show R15's line. */
export async function resolveVisitor(request: Request, secure: boolean): Promise<VisitorContext> {
  const signingSecret = getSecret("MANDATE_SIGNING_KEY");
  if (!signingSecret) throw new Error("MANDATE_SIGNING_KEY is not configured");
  const db = await getDb();
  const ledger = await db.transaction((tx) =>
    getOrCreateVisitorLedger(tx, readCookie(request, VISITOR_COOKIE), signingSecret, now()),
  );
  return {
    ledgerId: ledger.ledgerId,
    setCookie: ledger.newCookie ? visitorCookieHeader(ledger.newCookie, secure) : null,
    signingSecret,
  };
}
