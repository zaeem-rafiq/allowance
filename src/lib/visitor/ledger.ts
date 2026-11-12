// Ledgers (R20, KTD11). The demo parent has one ledger. Each visitor gets a private ledger tied
// to a random ID in an httpOnly cookie, starting with a copy of the demo parent's mandate.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Queryable } from "@/lib/db";
import { DEMO_MANDATE } from "@/lib/mandate/demo-mandate";
import type { IntentMandate } from "@/lib/mandate/schema";
import { type SignedMandate, deriveSigningKey, mandateHash, signMandate } from "@/lib/mandate/sign";

export const VISITOR_COOKIE = "allowance_visitor";
export const DEMO_LEDGER_ID = "demo-parent";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 60;

export interface MandateVersionRow {
  id: string;
  ledger_id: string;
  version: number;
  mandate: IntentMandate;
  hash: string;
  signature: string;
  public_key: string;
  created_at: string;
}

export function hashVisitorKey(value: string): string {
  return createHash("sha256").update(`visitor:${value}`).digest("hex");
}

/** The shape of every cookie this server issues (32 random bytes as base64url). Any other value has no ledger. */
export const VISITOR_COOKIE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The ID of the ledger that owns this visitor cookie, or null. This never creates a ledger. */
export async function findVisitorLedgerId(q: Queryable, cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue || !VISITOR_COOKIE_SHAPE.test(cookieValue)) return null;
  const rows = await q.query<{ id: string }>("SELECT id FROM ledgers WHERE visitor_key_hash = $1", [
    hashVisitorKey(cookieValue),
  ]);
  return rows[0]?.id ?? null;
}

export async function insertMandateVersion(
  q: Queryable,
  ledgerId: string,
  signed: SignedMandate,
  now: Date,
): Promise<MandateVersionRow> {
  const rows = await q.query<{ v: number | null }>(
    "SELECT max(version) AS v FROM mandate_versions WHERE ledger_id = $1",
    [ledgerId],
  );
  const version = (rows[0]?.v ?? 0) + 1;
  const id = randomUUID();
  const inserted = await q.query<MandateVersionRow>(
    `INSERT INTO mandate_versions (id, ledger_id, version, mandate, hash, signature, public_key, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING *`,
    [id, ledgerId, version, JSON.stringify(signed.mandate), signed.hash, signed.signature, signed.publicKey, now.toISOString()],
  );
  return inserted[0];
}

export async function currentMandate(q: Queryable, ledgerId: string): Promise<MandateVersionRow | null> {
  const rows = await q.query<MandateVersionRow>(
    "SELECT * FROM mandate_versions WHERE ledger_id = $1 ORDER BY version DESC LIMIT 1",
    [ledgerId],
  );
  return rows[0] ?? null;
}

/**
 * If a ledger's current mandate is the demo mandate signed by another key (for example after
 * MANDATE_SIGNING_KEY changed), signs the demo mandate again from the code's own copy, as a new
 * version. Only the trusted copy in code is re-signed, never mandate text read from the database.
 */
async function resignDemoCopyIfKeyChanged(q: Queryable, ledgerId: string, signingSecret: string, now: Date): Promise<void> {
  const current = await currentMandate(q, ledgerId);
  if (!current) return;
  if (current.public_key === deriveSigningKey(signingSecret).publicKeyBase64) return;
  if (current.hash !== mandateHash(DEMO_MANDATE)) return;
  await insertMandateVersion(q, ledgerId, signMandate(DEMO_MANDATE, signingSecret), now);
}

/** Creates the demo parent's ledger and signed demo mandate once. */
export async function ensureDemoLedger(q: Queryable, signingSecret: string, now: Date): Promise<void> {
  await q.query(
    "INSERT INTO ledgers (id, kind, created_at) VALUES ($1, 'demo', $2) ON CONFLICT (id) DO NOTHING",
    [DEMO_LEDGER_ID, now.toISOString()],
  );
  await q.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [DEMO_LEDGER_ID]);
  if (!(await currentMandate(q, DEMO_LEDGER_ID))) {
    await insertMandateVersion(q, DEMO_LEDGER_ID, signMandate(DEMO_MANDATE, signingSecret), now);
  } else {
    await resignDemoCopyIfKeyChanged(q, DEMO_LEDGER_ID, signingSecret, now);
  }
}

export interface VisitorLedger {
  ledgerId: string;
  /** Set when a new cookie must be sent back. */
  newCookie: string | null;
}

/**
 * Finds the ledger for a visitor cookie, or creates a new ledger with a new cookie. An unknown
 * or forged cookie value always gets a new ledger, never an existing one.
 */
export async function getOrCreateVisitorLedger(
  q: Queryable,
  cookieValue: string | undefined,
  signingSecret: string,
  now: Date,
): Promise<VisitorLedger> {
  const existingId = await findVisitorLedgerId(q, cookieValue);
  if (existingId) {
    await q.query("SELECT id FROM ledgers WHERE id = $1 FOR UPDATE", [existingId]);
    await resignDemoCopyIfKeyChanged(q, existingId, signingSecret, now);
    return { ledgerId: existingId, newCookie: null };
  }
  await ensureDemoLedger(q, signingSecret, now);
  const demo = await currentMandate(q, DEMO_LEDGER_ID);
  if (!demo) throw new Error("Demo mandate missing");
  if (demo.public_key !== deriveSigningKey(signingSecret).publicKeyBase64) throw new Error("Demo mandate key mismatch");
  const cookie = randomBytes(32).toString("base64url");
  const ledgerId = `v_${randomUUID()}`;
  await q.query("INSERT INTO ledgers (id, kind, visitor_key_hash, created_at) VALUES ($1, 'visitor', $2, $3)", [
    ledgerId,
    hashVisitorKey(cookie),
    now.toISOString(),
  ]);
  await insertMandateVersion(
    q,
    ledgerId,
    { mandate: demo.mandate, hash: demo.hash, signature: demo.signature, publicKey: demo.public_key },
    now,
  );
  return { ledgerId, newCookie: cookie };
}
