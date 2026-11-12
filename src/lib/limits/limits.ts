// Usage caps for the public page (R22, KTD12). Caps are database counters; a counter that
// cannot be read fails closed. Client addresses are stored only as salted hashes per hour.
import { createHmac } from "node:crypto";
import type { Queryable } from "@/lib/db";

export const HOUR_MS = 60 * 60 * 1000;

export const CAPS = {
  /** AI runs (agent and normal restock) per visitor per hour. */
  visitorRuns: 5,
  /** AI runs per address per hour: six times the visitor cap, for clients that drop cookies. */
  addressRuns: 30,
  /** Checkout actions (every run, including Skip the AI) per address per hour. */
  addressCheckouts: 30,
  /** Rule compiles per visitor per hour. */
  visitorCompiles: 3,
  /** Rule compiles per address per hour. */
  addressCompiles: 18,
  /** Rule-writer requests (read or sign) per address per hour, taken before a visitor ledger is made. */
  addressRuleCalls: 60,
  /** Signed rule versions per visitor per hour. */
  visitorSigns: 10,
  /** Owner sign-in attempts per address per hour. */
  ownerSignIns: 10,
} as const;

/**
 * Counts one use against a fixed window and says whether it fits under the limit. The count
 * only grows when the use fits, so a refused request does not push the window further.
 */
export async function takeFromCounter(
  q: Queryable,
  key: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<boolean> {
  // One atomic statement, so concurrent first requests for a new key cannot all slip through:
  // a new key starts at 1, an expired window restarts at 1, and otherwise the count grows only
  // while it is under the limit. No row back means the cap is reached.
  const rows = await q.query<{ count: number }>(
    `INSERT INTO counters (key, count, window_start) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN counters.window_start <= $3 THEN 1 ELSE counters.count + 1 END,
       window_start = CASE WHEN counters.window_start <= $3 THEN EXCLUDED.window_start ELSE counters.window_start END
     WHERE counters.window_start <= $3 OR counters.count < $4
     RETURNING count`,
    [key, now.toISOString(), new Date(now.getTime() - windowMs).toISOString(), limit],
  );
  return rows.length > 0 && limit >= 1;
}

/**
 * The client's address. On Render, Cloudflare writes CF-Connecting-IP on every request and
 * overwrites any copy the caller sent, while X-Forwarded-For keeps the caller's own entries at
 * the front (Render's PocketBase guide). So CF-Connecting-IP comes first, then the last
 * X-Forwarded-For entry, which the nearest proxy added.
 */
export function clientAddress(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || "unknown";
}

/** A salted hash of the address that changes every hour, so raw addresses are never stored. */
export function addressKey(address: string, salt: string, now: Date): string {
  const hour = Math.floor(now.getTime() / HOUR_MS);
  return createHmac("sha256", salt).update(`address:${hour}:${address}`).digest("hex").slice(0, 32);
}

/** True when this ledger already has a run in progress (started in the last 90 seconds). */
export async function runInProgress(q: Queryable, ledgerId: string, now: Date): Promise<boolean> {
  const rows = await q.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM runs WHERE ledger_id = $1 AND status = 'running' AND created_at > $2",
    [ledgerId, new Date(now.getTime() - 90_000).toISOString()],
  );
  return (rows[0]?.n ?? 0) > 0;
}
