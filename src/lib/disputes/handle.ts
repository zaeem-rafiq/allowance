// Dispute handling (R26, KTD14). Poll and webhook both end in processDispute, so a dispute is
// handled the same way however it arrives:
//   1. Read the dispute from PayPal (never trust a webhook's own payload).
//   2. Record its status. A new status is added to the history; earlier entries stay.
//   3. Match it to a stored charge by capture ID. An unknown capture ID stays unmatched.
//   4. Send evidence when the gate is open: the provide-evidence link and an evidence request
//      addressed to the seller. Evidence is claimed with one conditional UPDATE, so two racing
//      pollers or webhooks cannot both send it.
//
// Rule for a failed upload: a refusal from PayPal (a 4xx answer) is stored as the reason and is
// not sent again, because the same evidence would get the same answer. An outage (PayPal not
// reachable, 429 or 5xx) clears the claim, so the next poll tries again.
import type { Db, Queryable } from "@/lib/db";
import { type DisputesPort, type EvidenceResult, canProvideEvidence } from "@/lib/paypal/disputes";
import { buildEvidence } from "./evidence";

/** A date, or a clock. A clock lets "seen" and "evidence sent" differ by real seconds. */
export type Clock = Date | (() => Date);

function tick(clock: Clock): Date {
  return typeof clock === "function" ? clock() : clock;
}

/** A claim older than this is treated as abandoned (the process died after claiming). */
export const EVIDENCE_CLAIM_STALE_MS = 120_000;

export interface StatusEntry {
  status: string;
  at: string;
}

export interface DisputeRow {
  id: string;
  capture_id: string | null;
  attempt_id: string | null;
  matched: boolean;
  status: string;
  reason: string | null;
  first_seen_at: Date | string;
  evidence_claimed_at: Date | string | null;
  evidence_sent_at: Date | string | null;
  evidence_error: string | null;
  raw_status_history: StatusEntry[];
}

export type DisputeOutcome =
  | "evidence_sent"
  | "evidence_refused"
  | "evidence_retry_later"
  | "waiting"
  | "unmatched"
  | "already_handled";

export interface DisputeResult {
  disputeId: string;
  outcome: DisputeOutcome;
}

async function findAttemptForCaptures(q: Queryable, captureIds: string[]): Promise<{ attemptId: string; captureId: string } | null> {
  if (captureIds.length === 0) return null;
  const rows = await q.query<{ id: string; capture_id: string }>(
    "SELECT id, paypal->>'captureId' AS capture_id FROM attempts WHERE paypal->>'captureId' = ANY($1::text[]) LIMIT 1",
    [captureIds],
  );
  return rows[0] ? { attemptId: rows[0].id, captureId: rows[0].capture_id } : null;
}

/** Handles one dispute: record, match, and send evidence once when the gate allows. */
export async function processDispute(db: Db, port: DisputesPort, disputeId: string, clock: Clock): Promise<DisputeResult> {
  const detail = await port.get(disputeId);
  if (detail.id !== disputeId) throw new Error("PayPal returned a different dispute.");
  const seenAt = tick(clock).toISOString();

  const row = await db.transaction(async (tx) => {
    const match = await findAttemptForCaptures(tx, detail.captureIds);
    await tx.query(
      `INSERT INTO disputes (id, capture_id, attempt_id, matched, status, reason, first_seen_at, raw_status_history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (id) DO NOTHING`,
      [
        detail.id,
        match?.captureId ?? detail.captureIds[0] ?? null,
        match?.attemptId ?? null,
        match !== null,
        detail.status,
        detail.reason,
        seenAt,
        JSON.stringify([{ status: detail.status, at: seenAt }]),
      ],
    );
    const found = await tx.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1 FOR UPDATE", [detail.id]);
    const current = found[0];
    const history = Array.isArray(current.raw_status_history) ? current.raw_status_history : [];
    const nextHistory = history[history.length - 1]?.status === detail.status ? history : [...history, { status: detail.status, at: seenAt }];
    // An unmatched dispute is matched as soon as its capture ID is a stored charge.
    const becameMatched = !current.matched && match !== null;
    await tx.query(
      `UPDATE disputes SET status = $2, reason = coalesce($3, reason), raw_status_history = $4::jsonb,
         matched = matched OR $5::boolean, attempt_id = CASE WHEN $5::boolean THEN $6::text ELSE attempt_id END,
         capture_id = CASE WHEN $5::boolean THEN $7::text ELSE capture_id END
       WHERE id = $1`,
      [detail.id, detail.status, detail.reason, JSON.stringify(nextHistory), becameMatched, match?.attemptId ?? null, match?.captureId ?? null],
    );
    const updated = await tx.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1", [detail.id]);
    return updated[0];
  });

  if (!row.matched || !row.attempt_id) return { disputeId, outcome: "unmatched" };
  if (row.evidence_sent_at || row.evidence_error) return { disputeId, outcome: "already_handled" };
  if (!canProvideEvidence(detail)) return { disputeId, outcome: "waiting" };

  // Claim the one send. Only one caller gets a row back.
  const claimAt = tick(clock);
  const claimed = await db.query<{ id: string }>(
    `UPDATE disputes SET evidence_claimed_at = $2
     WHERE id = $1 AND matched AND evidence_sent_at IS NULL AND evidence_error IS NULL
       AND (evidence_claimed_at IS NULL OR evidence_claimed_at < $3)
     RETURNING id`,
    [disputeId, claimAt.toISOString(), new Date(claimAt.getTime() - EVIDENCE_CLAIM_STALE_MS).toISOString()],
  );
  if (claimed.length === 0) return { disputeId, outcome: "already_handled" };

  const evidence = await buildEvidence(db, row.attempt_id, disputeId, claimAt);
  if (!evidence) {
    await db.query("UPDATE disputes SET evidence_error = 'EVIDENCE_NOT_AVAILABLE' WHERE id = $1", [disputeId]);
    return { disputeId, outcome: "evidence_refused" };
  }
  let result: EvidenceResult;
  try {
    result = await port.provideEvidence(disputeId, evidence);
  } catch {
    result = { ok: false, reason: "PAYPAL_UNREACHABLE", retryable: true };
  }
  if (result.ok) {
    await db.query("UPDATE disputes SET evidence_sent_at = $2 WHERE id = $1", [disputeId, tick(clock).toISOString()]);
    return { disputeId, outcome: "evidence_sent" };
  }
  if (result.retryable) {
    await db.query("UPDATE disputes SET evidence_claimed_at = NULL WHERE id = $1", [disputeId]);
    return { disputeId, outcome: "evidence_retry_later" };
  }
  await db.query("UPDATE disputes SET evidence_error = $2 WHERE id = $1", [disputeId, result.reason.slice(0, 100)]);
  return { disputeId, outcome: "evidence_refused" };
}

/** What both the poll and the webhook call for one dispute. Repeats change nothing. */
export async function handleDisputeEvent(db: Db, port: DisputesPort, event: { disputeId: string }, clock: Clock): Promise<DisputeResult> {
  return processDispute(db, port, event.disputeId, clock);
}

export interface SyncSummary {
  listed: number;
  processed: number;
  evidenceSent: number;
  failed: number;
}

/** Matches stored disputes whose capture ID became a stored charge after they were first seen. No PayPal call. */
async function rematchUnmatched(db: Db): Promise<void> {
  await db.query(
    `UPDATE disputes d SET matched = true, attempt_id = a.id
     FROM attempts a WHERE d.matched = false AND d.capture_id IS NOT NULL AND a.paypal->>'captureId' = d.capture_id`,
  );
}

/**
 * The poll: list PayPal's recent disputes and handle each one that can still change. A dispute
 * whose evidence is already sent or refused, that is unmatched, or that is resolved, is read again
 * only when its status in the list changed. Throws when the list itself cannot be read.
 */
export async function syncDisputes(db: Db, port: DisputesPort, clock: Clock): Promise<SyncSummary> {
  await rematchUnmatched(db);
  const summaries = await port.listRecent();
  const summary: SyncSummary = { listed: summaries.length, processed: 0, evidenceSent: 0, failed: 0 };
  for (const s of summaries) {
    const existing = (await db.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1", [s.id]))[0];
    if (
      existing &&
      existing.status === s.status &&
      (existing.evidence_sent_at || existing.evidence_error || !existing.matched || s.status === "RESOLVED")
    ) {
      continue;
    }
    try {
      const result = await processDispute(db, port, s.id, clock);
      summary.processed++;
      if (result.outcome === "evidence_sent") summary.evidenceSent++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

// One poll at a time, and not more often than every MIN_POLL_GAP_MS, however many viewers have
// the timeline open. The result of a poll in flight is shared.
export const MIN_POLL_GAP_MS = 15_000;

const syncState = ((globalThis as Record<string, unknown>).__allowanceDisputeSync ??= { lastAt: 0, inFlight: null }) as {
  lastAt: number;
  inFlight: Promise<SyncSummary | null> | null;
};

export function resetSyncThrottleForTests(): void {
  syncState.lastAt = 0;
  syncState.inFlight = null;
}

/** The timeline's poll. Never throws; returns null when it skipped or PayPal could not be read. */
export async function syncDisputesThrottled(db: Db, port: DisputesPort, clock: Clock, minGapMs = MIN_POLL_GAP_MS): Promise<SyncSummary | null> {
  if (syncState.inFlight) return syncState.inFlight;
  if (Date.now() - syncState.lastAt < minGapMs) return null;
  syncState.lastAt = Date.now();
  const run = syncDisputes(db, port, clock).catch(() => null);
  syncState.inFlight = run;
  try {
    return await run;
  } finally {
    syncState.inFlight = null;
  }
}

// --- The webhook -----------------------------------------------------------------------------

const MAX_WEBHOOK_BYTES = 256 * 1024;
const DISPUTE_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The dispute ID of a CUSTOMER.DISPUTE.* event, or null for any other event. */
export function disputeIdFromEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as { event_type?: unknown; resource?: unknown };
  if (typeof e.event_type !== "string" || !e.event_type.startsWith("CUSTOMER.DISPUTE.")) return null;
  const resource = e.resource as { dispute_id?: unknown } | undefined;
  const id = resource?.dispute_id;
  return typeof id === "string" && DISPUTE_ID.test(id) ? id : null;
}

export interface WebhookResult {
  status: 200 | 400 | 500 | 503;
  body: { ok: boolean; error?: string; ignored?: boolean; outcome?: DisputeOutcome };
}

/**
 * The webhook, as a function the route calls. No webhook ID set: 503, and nothing is touched.
 * A message PayPal does not confirm: 400, and nothing changes. A confirmed dispute event is
 * handled by re-reading the dispute from PayPal. A failure after that answers 500, so PayPal
 * delivers the event again.
 */
export async function receiveWebhook(opts: {
  getDb: () => Promise<Db>;
  /** Called only after the webhook ID check, so a server without one touches nothing. */
  getPort: () => DisputesPort;
  webhookId: string | undefined;
  headers: Record<string, string | undefined>;
  rawBody: string;
  clock: Clock;
}): Promise<WebhookResult> {
  const webhookId = opts.webhookId?.trim();
  if (!webhookId) return { status: 503, body: { ok: false, error: "Webhooks are not set up on this server." } };
  if (opts.rawBody.length > MAX_WEBHOOK_BYTES) return { status: 400, body: { ok: false, error: "Message too large." } };
  let port: DisputesPort | null = null;
  let verified = false;
  try {
    port = opts.getPort();
    verified = await port.verifyWebhook({ webhookId, headers: opts.headers, rawBody: opts.rawBody });
  } catch {
    verified = false;
  }
  if (!verified || !port) return { status: 400, body: { ok: false, error: "PayPal did not confirm this message." } };
  let event: unknown;
  try {
    event = JSON.parse(opts.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "Message is not JSON." } };
  }
  const disputeId = disputeIdFromEvent(event);
  if (!disputeId) return { status: 200, body: { ok: true, ignored: true } };
  try {
    const result = await handleDisputeEvent(await opts.getDb(), port, { disputeId }, opts.clock);
    return { status: 200, body: { ok: true, outcome: result.outcome } };
  } catch {
    return { status: 500, body: { ok: false, error: "Could not handle the dispute." } };
  }
}
