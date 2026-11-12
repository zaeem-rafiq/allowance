// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_SECRETS } from "@/lib/mode";
import { issueSessionCookie, ownerConfigured, readSessionCookie, secretMatches } from "./session";

describe("owner session", () => {
  beforeEach(() => vi.stubEnv("ALLOWANCE_TEST_MODE", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a wrong secret and accepts the right one", () => {
    expect(secretMatches("wrong")).toBe(false);
    expect(secretMatches("")).toBe(false);
    expect(secretMatches(undefined)).toBe(false);
    expect(secretMatches(TEST_SECRETS.OWNER_SECRET)).toBe(true);
  });

  it("issues a cookie that reads back, and rejects a changed one", () => {
    const now = Date.UTC(2026, 10, 11, 21);
    const { value, session } = issueSessionCookie(now);
    expect(readSessionCookie(value, now)).toEqual(session);
    const [issued, nonce, mac] = value.split(".");
    expect(readSessionCookie(`${issued}.${nonce}x.${mac}`, now)).toBeNull();
    expect(readSessionCookie(`${Number(issued) + 1}.${nonce}.${mac}`, now)).toBeNull();
    expect(readSessionCookie("garbage", now)).toBeNull();
  });

  it("expires after 7 days", () => {
    const now = Date.UTC(2026, 10, 11, 21);
    const { value } = issueSessionCookie(now);
    expect(readSessionCookie(value, now + 6 * 86_400_000)).not.toBeNull();
    expect(readSessionCookie(value, now + 8 * 86_400_000)).toBeNull();
  });

  it("stays closed when OWNER_SECRET is unset in a production build", () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OWNER_SECRET", "");
    expect(ownerConfigured()).toBe(false);
    expect(secretMatches("")).toBe(false);
    expect(secretMatches("anything-long-enough-here")).toBe(false);
    expect(() => issueSessionCookie(Date.now())).toThrow(/not configured/);
  });
});
