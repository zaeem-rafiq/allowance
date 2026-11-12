// Owner identity (KTD11). The owner signs in with OWNER_SECRET, compared in constant time,
// and gets a signed httpOnly cookie. Each sign-in carries a random nonce, so a PayPal return
// can be tied to the owner session that started it.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSecret } from "@/lib/secrets";

export const OWNER_COOKIE = "allowance_owner";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of a typed secret with OWNER_SECRET. False when unset. */
export function secretMatches(typed: unknown): boolean {
  const secret = getSecret("OWNER_SECRET");
  if (!secret || typeof typed !== "string" || typed.length === 0 || typed.length > 512) return false;
  return timingSafeEqual(digest(typed), digest(secret));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`owner-session:${payload}`).digest("base64url");
}

export interface OwnerSession {
  nonce: string;
  issuedAt: number;
}

export function issueSessionCookie(nowMs: number): { value: string; session: OwnerSession } {
  const secret = getSecret("OWNER_SECRET");
  if (!secret) throw new Error("OWNER_SECRET is not configured.");
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${nowMs}.${nonce}`;
  return { value: `${payload}.${sign(payload, secret)}`, session: { nonce, issuedAt: nowMs } };
}

/** Returns the session for a valid, unexpired cookie value, or null. */
export function readSessionCookie(value: string | undefined, nowMs: number): OwnerSession | null {
  const secret = getSecret("OWNER_SECRET");
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [issued, nonce, mac] = parts;
  const expected = sign(`${issued}.${nonce}`, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || nowMs - issuedAt > MAX_AGE_MS || issuedAt - nowMs > 60_000) return null;
  return { nonce, issuedAt };
}

export function ownerConfigured(): boolean {
  return getSecret("OWNER_SECRET") !== null;
}
