// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createPglite, migrate } from "@/lib/db";
import { TEST_SECRETS } from "@/lib/mode";
import { currentMandate, getOrCreateVisitorLedger } from "@/lib/visitor/ledger";
import { LOG_LIMIT, type LogAttempt, getSpendLog, toLogRow } from "./spend-log";

const T0 = new Date("2026-11-11T21:00:00Z");
const RECEIPT = "abcdefghijklmnopqrstuv";

interface Seed {
  state: string;
  source?: string;
  rule?: string;
  totalCents?: number;
  capturedCents?: number;
  receiptId?: string | null;
  orderId?: string | null;
  minutesAfter?: number;
}

describe("spend log", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    db = await createPglite();
    await migrate(db);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  async function visitor() {
    const v = await getOrCreateVisitorLedger(db, undefined, TEST_SECRETS.MANDATE_SIGNING_KEY, T0);
    if (!v.newCookie) throw new Error("expected a new cookie");
    return { ledgerId: v.ledgerId, cookie: v.newCookie };
  }

  async function seed(ledgerId: string, a: Seed): Promise<string> {
    const mv = await currentMandate(db, ledgerId);
    if (!mv) throw new Error("no mandate");
    const id = randomUUID();
    const at = new Date(T0.getTime() + (a.minutesAfter ?? 0) * 60_000).toISOString();
    const paypal = a.orderId
      ? JSON.stringify({ orderId: a.orderId, captureId: "CAP-SECRET", amountCents: a.capturedCents ?? 0, at })
      : null;
    await db.query(
      `INSERT INTO attempts (id, ledger_id, mandate_version_id, mandate_version, mandate_hash, source, state, verdict,
         rule, total_cents, captured_cents, receipt_id, paypal, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15)`,
      [
        id,
        ledgerId,
        mv.id,
        mv.version,
        mv.hash,
        a.source ?? "restock",
        a.state,
        JSON.stringify({ decision: "block", hiddenLine: "SECRET HIDDEN LINE" }),
        a.rule ?? "$120 a week",
        a.totalCents ?? 3400,
        a.capturedCents ?? 0,
        a.receiptId ?? null,
        paypal,
        "internal message",
        at,
      ],
    );
    return id;
  }

  it("never shows one visitor's attempts to another visitor", async () => {
    const a = await visitor();
    const b = await visitor();
    const aId = await seed(a.ledgerId, { state: "blocked", source: "skip", rule: "never gift cards", totalCents: 53400 });
    const bId = await seed(b.ledgerId, { state: "captured", capturedCents: 3400, orderId: "ORDER-B", receiptId: RECEIPT });

    expect((await getSpendLog(db, a.cookie)).map((r) => r.id)).toEqual([aId]);
    expect((await getSpendLog(db, b.cookie)).map((r) => r.id)).toEqual([bId]);
  });

  it("gives an empty log, and creates no ledger, for no cookie or an unknown cookie", async () => {
    const a = await visitor();
    await seed(a.ledgerId, { state: "blocked" });
    const ledgersBefore = await db.query<{ n: string }>("SELECT count(*) AS n FROM ledgers");

    expect(await getSpendLog(db, undefined)).toEqual([]);
    expect(await getSpendLog(db, "")).toEqual([]);
    expect(await getSpendLog(db, "x".repeat(43))).toEqual([]); // the right shape, but no ledger owns it
    expect(await getSpendLog(db, "not a cookie")).toEqual([]);
    expect(await db.query("SELECT count(*) AS n FROM ledgers")).toEqual(ledgersBefore);
  });

  it("never shows the demo parent's attempts", async () => {
    const a = await visitor();
    await seed("demo-parent", { state: "captured", capturedCents: 100, orderId: "ORDER-DEMO" });
    expect(await getSpendLog(db, a.cookie)).toEqual([]);
  });

  it("labels blocked, charged and allowed-not-charged attempts", async () => {
    const a = await visitor();
    await seed(a.ledgerId, { state: "blocked", source: "skip", rule: "never gift cards", totalCents: 53400, minutesAfter: 1 });
    await seed(a.ledgerId, {
      state: "captured",
      source: "restock",
      rule: "$120 a week",
      totalCents: 3400,
      capturedCents: 3400,
      orderId: "FAKE-ORDER-1",
      receiptId: RECEIPT,
      minutesAfter: 2,
    });
    await seed(a.ledgerId, { state: "allowed_not_charged", source: "agent", rule: "$120 a week", minutesAfter: 3 });

    const rows = await getSpendLog(db, a.cookie);
    expect(rows.map((r) => [r.source, r.result, r.rule, r.amount, r.paypalOrder, r.receiptId])).toEqual([
      ["AI agent", "Allowed, not charged", "$120 a week", "$34.00", "—", null],
      ["Normal restock", "Charged", "$120 a week", "$34.00", "FAKE-ORDER-1", RECEIPT],
      ["Skip the AI", "Blocked", "never gift cards", "$534.00", "—", null],
    ]);
  });

  it("lists newest first and at most 200 attempts", async () => {
    const a = await visitor();
    await seed(a.ledgerId, { state: "blocked", rule: "oldest", minutesAfter: 0 });
    await seed(a.ledgerId, { state: "blocked", rule: "newest", minutesAfter: 5000 });
    const mv = await currentMandate(db, a.ledgerId);
    await db.query(
      `INSERT INTO attempts (id, ledger_id, mandate_version_id, mandate_version, mandate_hash, source, state, verdict, rule,
         total_cents, created_at)
       SELECT 'bulk-' || g, $1, $2, $3, $4, 'restock', 'blocked', '{}'::jsonb, 'bulk', 100, $5::timestamptz + g * interval '1 minute'
         FROM generate_series(1, 250) g`,
      [a.ledgerId, mv?.id, mv?.version, mv?.hash, T0.toISOString()],
    );

    const rows = await getSpendLog(db, a.cookie);
    expect(rows).toHaveLength(LOG_LIMIT);
    expect(rows[0].rule).toBe("newest");
    const times = rows.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it("returns only the fields the table needs", async () => {
    const a = await visitor();
    await seed(a.ledgerId, { state: "captured", capturedCents: 3400, orderId: "ORDER-1", receiptId: RECEIPT });

    const [row] = await getSpendLog(db, a.cookie);
    expect(Object.keys(row).sort()).toEqual(
      ["amount", "amountCents", "createdAt", "id", "paypalOrder", "receiptId", "result", "rule", "source"].sort(),
    );
    const text = JSON.stringify(row);
    expect(text).not.toContain("SECRET HIDDEN LINE");
    expect(text).not.toContain("CAP-SECRET");
    expect(text).not.toContain("internal message");
    expect(row.createdAt).toBe(T0.toISOString());
  });

  it("returns a rule that contains HTML unchanged, as a string", async () => {
    const a = await visitor();
    const rule = `<img src=x onerror="alert(1)"><!-- gift --> never <b>gift</b> cards`;
    await seed(a.ledgerId, { state: "blocked", rule });

    const [row] = await getSpendLog(db, a.cookie);
    expect(row.rule).toBe(rule);
    expect(toLogRow({ ...baseAttempt, rule }).rule).toBe(rule);
  });
});

const baseAttempt: LogAttempt = {
  id: "a1",
  source: "restock",
  state: "blocked",
  rule: "r",
  total_cents: 3400,
  captured_cents: 0,
  receipt_id: null,
  paypal: null,
  created_at: "2026-11-11T21:00:00.000Z",
};

describe("toLogRow", () => {
  it("shows the charged amount for a charge and the attempted amount otherwise", () => {
    expect(toLogRow({ ...baseAttempt, state: "captured", captured_cents: 3399 }).amount).toBe("$33.99");
    expect(toLogRow({ ...baseAttempt, state: "blocked", total_cents: 53400, captured_cents: 0 }).amount).toBe("$534.00");
    expect(toLogRow({ ...baseAttempt, total_cents: 5 }).amount).toBe("$0.05");
    expect(toLogRow({ ...baseAttempt, total_cents: 123456789 }).amount).toBe("$1,234,567.89");
  });

  it("labels every state and source, with a safe fallback for new ones", () => {
    const result = (state: string) => toLogRow({ ...baseAttempt, state }).result;
    expect(result("captured")).toBe("Charged");
    expect(result("blocked")).toBe("Blocked");
    expect(result("allowed_not_charged")).toBe("Allowed, not charged");
    expect(result("pending")).toBe("Asked first");
    expect(result("stopped")).toBe("Asked first");
    expect(result("declined")).toBe("Asked first, declined");
    expect(result("expired")).toBe("Asked first, expired");
    expect(result("reserved")).toBe("Checking with PayPal");
    expect(result("unknown")).toBe("Checking with PayPal");
    expect(result("something-new")).toBe("Unknown");

    const source = (s: string) => toLogRow({ ...baseAttempt, source: s }).source;
    expect(source("agent")).toBe("AI agent");
    expect(source("restock")).toBe("Normal restock");
    expect(source("skip")).toBe("Skip the AI");
    expect(source("approval")).toBe("After your approval");
    expect(source("something-new")).toBe("Other");
  });

  it("accepts a Date or a string for the time, and drops a receipt ID of the wrong shape", () => {
    const at = new Date("2026-11-11T21:00:00Z");
    expect(toLogRow({ ...baseAttempt, created_at: at }).createdAt).toBe("2026-11-11T21:00:00.000Z");
    expect(toLogRow({ ...baseAttempt, receipt_id: "../../etc" }).receiptId).toBeNull();
    expect(toLogRow({ ...baseAttempt, receipt_id: RECEIPT }).receiptId).toBe(RECEIPT);
  });
});
