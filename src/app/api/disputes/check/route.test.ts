// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbForTests } from "@/lib/db";
import { FAKE_VALID_SIGNATURE } from "@/lib/paypal/disputes-fake";
import { resetTestHooks, setTestHooks } from "@/lib/test-hooks";
import { POST as webhook } from "../../paypal/webhook/route";
import { POST as check } from "./route";

const currentOwner = vi.fn();
vi.mock("@/lib/owner/guard", () => ({ currentOwner: () => currentOwner() }));

const ORIGIN = "https://allowance.test";
const post = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const { origin = ORIGIN, headers, ...rest } = init;
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), ...(headers as Record<string, string> | undefined) },
    ...rest,
  });
};

beforeEach(() => {
  vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
  currentOwner.mockReset();
});
afterEach(async () => {
  resetTestHooks();
  await resetDbForTests();
  vi.unstubAllEnvs();
});

describe("POST /api/disputes/check", () => {
  it("refuses a request from another origin, and a visitor who is not the owner", async () => {
    currentOwner.mockResolvedValue({ nonce: "n", issuedAt: 1 });
    expect((await check(post("/api/disputes/check", { origin: "https://evil.test" }))).status).toBe(403);
    expect((await check(post("/api/disputes/check", { origin: null }))).status).toBe(403);
    currentOwner.mockResolvedValue(null);
    expect((await check(post("/api/disputes/check"))).status).toBe(403);
    expect(await (await getDb()).query("SELECT id FROM disputes")).toEqual([]);
  });

  it("lets the owner poll, stores what PayPal lists, and goes back to the list", async () => {
    currentOwner.mockResolvedValue({ nonce: "n", issuedAt: 1 });
    setTestHooks({ disputes: [{ id: "PP-D-9", captureId: "NOT-OURS", status: "WAITING_FOR_SELLER_RESPONSE", withEvidenceLink: true }] });
    const res = await check(post("/api/disputes/check"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/disputes?check=done&seen=1&sent=0`);
    const rows = await (await getDb()).query<{ id: string; matched: boolean }>("SELECT id, matched FROM disputes");
    expect(rows).toEqual([{ id: "PP-D-9", matched: false }]);
  });
});

describe("POST /api/paypal/webhook", () => {
  const event = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} });

  it("answers 503 when no webhook ID is set", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    const res = await webhook(post("/api/paypal/webhook", { body: event }));
    expect(res.status).toBe(503);
  });

  it("answers 400 for a message PayPal does not confirm, and 200 for one it does", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-ID");
    expect((await webhook(post("/api/paypal/webhook", { body: event, headers: { "PayPal-Transmission-Sig": "forged" } }))).status).toBe(400);
    const ok = await webhook(post("/api/paypal/webhook", { body: event, headers: { "PayPal-Transmission-Sig": FAKE_VALID_SIGNATURE } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ignored: true });
  });
});
