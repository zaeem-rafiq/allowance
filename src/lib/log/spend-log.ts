// The spend log (U14): every checkout attempt in ONE visitor's own ledger, with only the
// fields the table shows. The query never creates a ledger and never reads another visitor's rows.
import type { Queryable } from "@/lib/db";
import { hashVisitorKey } from "@/lib/visitor/ledger";

export const LOG_LIMIT = 200;
export const NO_VALUE = "—";

/** One row of the table. Plain strings and numbers only: no hidden lines, mandate or tokens. */
export interface LogRow {
  id: string;
  /** ISO time. The browser formats it in the viewer's own time zone. */
  createdAt: string;
  source: string;
  result: string;
  rule: string;
  amount: string;
  amountCents: number;
  paypalOrder: string;
  /** Set only when a receipt exists, so the table can link to it. */
  receiptId: string | null;
}

/** The columns of an `attempts` row that the log reads. */
export interface LogAttempt {
  id: string;
  source: string;
  state: string;
  rule: string;
  total_cents: number;
  captured_cents: number;
  receipt_id: string | null;
  paypal: { orderId?: string } | null;
  /** A string from the type, a Date from some database drivers. */
  created_at: string | Date;
}

// Keyed on plain strings, so a state or source added later shows a safe fallback, never a crash.
const SOURCE_LABELS: Record<string, string> = {
  agent: "AI agent",
  restock: "Normal restock",
  skip: "Skip the AI",
  approval: "After your approval",
};

const RESULT_LABELS: Record<string, string> = {
  captured: "Charged",
  blocked: "Blocked",
  allowed_not_charged: "Allowed, not charged",
  pending: "Asked first",
  stopped: "Asked first",
  declined: "Asked first, declined",
  expired: "Asked first, expired",
  reserved: "Checking with PayPal",
  unknown: "Checking with PayPal",
};

const RECEIPT_ID = /^[A-Za-z0-9_-]{22}$/;
/** The same shape the visitor cookie is issued with. Anything else has no ledger. */
const VISITOR_COOKIE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Integer cents to "$34.00". Whole-number maths only. */
function dollars(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return NO_VALUE;
  const rest = String(cents % 100).padStart(2, "0");
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${rest}`;
}

/** Maps one stored attempt to the table row. Pure, so it is unit-tested without a database. */
export function toLogRow(attempt: LogAttempt): LogRow {
  const captured = attempt.state === "captured";
  const amountCents = Number(captured ? attempt.captured_cents : attempt.total_cents);
  const orderId = attempt.paypal?.orderId;
  return {
    id: attempt.id,
    createdAt: new Date(attempt.created_at).toISOString(),
    source: SOURCE_LABELS[attempt.source] ?? "Other",
    result: RESULT_LABELS[attempt.state] ?? "Unknown",
    rule: attempt.rule,
    amount: dollars(amountCents),
    amountCents,
    paypalOrder: typeof orderId === "string" && orderId !== "" ? orderId : NO_VALUE,
    receiptId: attempt.receipt_id && RECEIPT_ID.test(attempt.receipt_id) ? attempt.receipt_id : null,
  };
}

/**
 * The log for the ledger that owns this visitor cookie, newest first, at most LOG_LIMIT rows.
 * No cookie, or a cookie no ledger owns, gives an empty log. This never creates a ledger.
 */
export async function getSpendLog(q: Queryable, cookieValue: string | undefined): Promise<LogRow[]> {
  if (!cookieValue || !VISITOR_COOKIE_SHAPE.test(cookieValue)) return [];
  const rows = await q.query<LogAttempt>(
    `SELECT a.id, a.source, a.state, a.rule, a.total_cents, a.captured_cents, a.receipt_id, a.paypal, a.created_at
       FROM attempts a JOIN ledgers l ON l.id = a.ledger_id
      WHERE l.visitor_key_hash = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [hashVisitorKey(cookieValue), LOG_LIMIT],
  );
  return rows.map(toLogRow);
}
