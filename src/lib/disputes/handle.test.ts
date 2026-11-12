// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTOCK_LIST } from "@/lib/catalog/catalog";
import { type AttemptRow, checkout } from "@/lib/checkout/checkout";
import { type Db, createPglite, migrate } from "@/lib/db";
import { deriveSigningKey } from "@/lib/mandate/sign";
import { TEST_SECRETS } from "@/lib/mode";
import type { DisputesPort } from "@/lib/paypal/disputes";
import { FAKE_VALID_SIGNATURE, FakeDisputes, type FakeDisputeScript, fakeDisputeCalls, resetFakeDisputeCalls } from "@/lib/paypal/disputes-fake";
import { FakePayPal } from "@/lib/paypal/fake";
import { createRun } from "@/lib/runs/run";
import { SAVED_PAYPAL_KEY, setSetting } from "@/lib/settings";
import { resetTestHooks, setTestHooks } from "@/lib/test-hooks";
import { getOrCreateVisitorLedger, hashVisitorKey } from "@/lib/visitor/ledger";
import { buildNotes } from "./evidence";
import {
  type DisputeRow,
  disputeIdFromEvent,
  handleDisputeEvent,
  receiveWebhook,
  resetSyncThrottleForTests,
  syncDisputes,
  syncDisputesThrottled,
} from "./handle";

const KEY = TEST_SECRETS.MANDATE_SIGNING_KEY;
const T0 = new Date("2026-11-12T15:00:00Z");
const HIDDEN = "SECRET-HIDDEN-LINE-OF-VISITOR-A";
const OTHER_HIDDEN = "SECRET-HIDDEN-LINE-OF-VISITOR-B";

let db: Db;
let paypal: FakePayPal;
let port: DisputesPort;
let clockMs: number;
const clock = () => new Date(T0.getTime() + clockMs);
const calls = () => fakeDisputeCalls().provideEvidenceCalls;

function script(over: Partial<FakeDisputeScript> = {}): FakeDisputeScript {
  return { id: "PP-D-1", captureId: "FAKE-CAPTURE-1", status: "WAITING_FOR_SELLER_RESPONSE", withEvidenceLink: true, ...over };
}
function setDisputes(...d: FakeDisputeScript[]) {
  setTestHooks({ disputes: d });
}
async function row(id = "PP-D-1"): Promise<DisputeRow> {
  return (await db.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1", [id]))[0];
}

/** A visitor's charge through the real checkout, with a run that has steps. */
async function charge(opts: { hiddenLine: string; cookieSeed?: string }) {
  const ledger = await getOrCreateVisitorLedger(db, undefined, KEY, T0);
  const runId = await createRun(db, { ledgerId: ledger.ledgerId, kind: "agent", hiddenLine: opts.hiddenLine }, T0);
  const steps = ["Opened Paper towels, 6 rolls. The page has a hidden line.", `Thought: I read ${opts.hiddenLine} and ignored it.`, "Checked out a $34 cart."];
  for (const [i, text] of steps.entries()) {
    await db.query("INSERT INTO run_steps (run_id, seq, kind, detail, created_at) VALUES ($1, $2, 'tool', $3::jsonb, $4)", [
      runId,
      i + 1,
      JSON.stringify({ text }),
      T0.toISOString(),
    ]);
  }
  const result = await checkout(
    db,
    paypal,
    {
      attemptId: `attempt-${runId}`,
      ledgerId: ledger.ledgerId,
      runId,
      source: "agent",
      cart: [...RESTOCK_LIST],
      expectedPublicKey: deriveSigningKey(KEY).publicKeyBase64,
    },
    T0,
  );
  expect(result.attempt?.state).toBe("captured");
  return { attempt: result.attempt as AttemptRow, ledgerId: ledger.ledgerId, cookie: ledger.newCookie! };
}

beforeEach(async () => {
  vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
  db = await createPglite();
  await migrate(db);
  await setSetting(db, SAVED_PAYPAL_KEY, { paymentTokenId: "FAKE-VAULT-SEEDED", customerId: null, savedAt: T0.toISOString() });
  paypal = new FakePayPal();
  port = new FakeDisputes();
  clockMs = 0;
  resetFakeDisputeCalls();
  resetSyncThrottleForTests();
});
afterEach(async () => {
  resetTestHooks();
  vi.unstubAllEnvs();
  await db.close();
});

describe("sending evidence", () => {
  it("sends once, and a repeated event sends nothing more", async () => {
    const { attempt } = await charge({ hiddenLine: HIDDEN });
    expect(attempt.paypal?.captureId).toBe("FAKE-CAPTURE-1");
    setDisputes(script());

    clockMs = 0;
    const first = await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock);
    expect(first.outcome).toBe("evidence_sent");
    expect(calls()).toBe(1);

    clockMs = 5_000;
    expect((await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock)).outcome).toBe("already_handled");
    await syncDisputes(db, port, clock);
    await syncDisputes(db, port, clock);
    expect(calls()).toBe(1);

    const r = await row();
    expect(r.matched).toBe(true);
    expect(r.attempt_id).toBe(attempt.id);
    expect(r.capture_id).toBe("FAKE-CAPTURE-1");
    expect(r.evidence_error).toBeNull();
    expect(new Date(r.evidence_sent_at!).toISOString()).toBe(T0.toISOString());
    expect(r.raw_status_history).toEqual([{ status: "WAITING_FOR_SELLER_RESPONSE", at: T0.toISOString() }]);
  });

  it("sends once when two events arrive together", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    const results = await Promise.all([
      handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock),
      handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock),
      handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock),
    ]);
    expect(calls()).toBe(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(["already_handled", "already_handled", "evidence_sent"]);
  });

  it("shows waiting without the link, and a later poll that finds the link sends", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script({ withEvidenceLink: false }));
    expect((await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock)).outcome).toBe("waiting");
    expect(calls()).toBe(0);
    expect((await row()).evidence_sent_at).toBeNull();

    // A link with no request addressed to the seller is still waiting.
    setDisputes(script({ withEvidenceLink: true, requestedFromSeller: false }));
    await syncDisputes(db, port, clock);
    expect(calls()).toBe(0);

    clockMs = 42_000;
    setDisputes(script({ withEvidenceLink: true }));
    const summary = await syncDisputes(db, port, clock);
    expect(summary.evidenceSent).toBe(1);
    expect(calls()).toBe(1);
    const r = await row();
    expect(new Date(r.evidence_sent_at!).getTime() - new Date(r.first_seen_at).getTime()).toBe(42_000);
  });

  it("stores an unknown capture ID as unmatched and sends nothing", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script({ captureId: "SOMEONE-ELSES-CAPTURE" }));
    expect((await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock)).outcome).toBe("unmatched");
    await syncDisputes(db, port, clock);
    expect(calls()).toBe(0);
    const r = await row();
    expect(r.matched).toBe(false);
    expect(r.attempt_id).toBeNull();
    expect(r.capture_id).toBe("SOMEONE-ELSES-CAPTURE");
  });

  it("matches a dispute that was unmatched when the charge is stored later", async () => {
    setDisputes(script());
    await syncDisputes(db, port, clock);
    expect((await row()).matched).toBe(false);
    await charge({ hiddenLine: HIDDEN }); // becomes FAKE-CAPTURE-1
    const summary = await syncDisputes(db, port, clock);
    expect(summary.evidenceSent).toBe(1);
    expect((await row()).matched).toBe(true);
  });

  it("stores PayPal's reason when it refuses, and does not send again", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script({ refuseEvidence: true }));
    expect((await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock)).outcome).toBe("evidence_refused");
    const r = await row();
    expect(r.evidence_error).toBe("EVIDENCE_NOT_ACCEPTED");
    expect(r.evidence_sent_at).toBeNull();
    await syncDisputes(db, port, clock);
    await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock);
    expect(calls()).toBe(1);
  });

  it("tries again after an outage, because nothing reached PayPal", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    let n = 0;
    const flaky: DisputesPort = {
      listRecent: () => port.listRecent(),
      get: (id) => port.get(id),
      verifyWebhook: (a) => port.verifyWebhook(a),
      provideEvidence: async () => (++n === 1 ? { ok: false, reason: "PAYPAL_UNREACHABLE", retryable: true } : { ok: true }),
    };
    expect((await handleDisputeEvent(db, flaky, { disputeId: "PP-D-1" }, clock)).outcome).toBe("evidence_retry_later");
    expect((await row()).evidence_error).toBeNull();
    expect((await handleDisputeEvent(db, flaky, { disputeId: "PP-D-1" }, clock)).outcome).toBe("evidence_sent");
    expect(n).toBe(2);
  });

  it("adds a resolved status with its date and keeps the earlier entries", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    await syncDisputes(db, port, clock);
    clockMs = 60_000;
    setDisputes(script({ status: "UNDER_REVIEW", withEvidenceLink: false }));
    await syncDisputes(db, port, clock);
    clockMs = 120_000;
    setDisputes(script({ status: "RESOLVED", withEvidenceLink: false }));
    await syncDisputes(db, port, clock);
    const read = vi.spyOn(port, "get");
    await syncDisputes(db, port, clock); // a repeat adds nothing, and a resolved dispute is not read again
    expect(read).not.toHaveBeenCalled();
    const r = await row();
    expect(r.status).toBe("RESOLVED");
    expect(r.raw_status_history).toEqual([
      { status: "WAITING_FOR_SELLER_RESPONSE", at: T0.toISOString() },
      { status: "UNDER_REVIEW", at: new Date(T0.getTime() + 60_000).toISOString() },
      { status: "RESOLVED", at: new Date(T0.getTime() + 120_000).toISOString() },
    ]);
    expect(calls()).toBe(1);
  });

  it("builds evidence from this attempt's own mandate, cart and steps, with no secret", async () => {
    const mine = await charge({ hiddenLine: HIDDEN });
    const other = await charge({ hiddenLine: OTHER_HIDDEN });
    expect(other.attempt.paypal?.captureId).toBe("FAKE-CAPTURE-2");
    setDisputes(script({ captureId: "FAKE-CAPTURE-1" }));
    await handleDisputeEvent(db, port, { disputeId: "PP-D-1" }, clock);

    const sent = fakeDisputeCalls().lastEvidence!;
    expect(sent.disputeId).toBe("PP-D-1");
    const doc = JSON.parse(sent.evidence.document.json);
    const version = (await db.query<{ version: number; hash: string; signature: string; public_key: string }>(
      "SELECT version, hash, signature, public_key FROM mandate_versions WHERE id = $1",
      [mine.attempt.mandate_version_id],
    ))[0];
    expect(doc.mandate.version).toBe(version.version);
    expect(doc.mandate.hash_sha256).toBe(version.hash);
    expect(doc.mandate.signature_ed25519_base64).toBe(version.signature);
    expect(doc.mandate.public_key_base64).toBe(version.public_key);
    expect(doc.mandate.content.type).toBe("IntentMandate");
    expect(doc.charge.paypal_capture_id).toBe("FAKE-CAPTURE-1");
    expect(doc.cart.map((l: { product_id: string }) => l.product_id).sort()).toEqual(RESTOCK_LIST.map((l) => l.productId).sort());
    expect(doc.agent_steps.map((s: { seq: number }) => s.seq)).toEqual([1, 2, 3]);
    expect(doc.agent_steps[0].text).toContain("hidden line");

    const everything = sent.evidence.document.json + sent.evidence.notes;
    for (const secret of [
      KEY,
      TEST_SECRETS.OWNER_SECRET,
      "FAKE-VAULT",
      mine.cookie,
      hashVisitorKey(mine.cookie),
      mine.ledgerId,
      other.ledgerId,
      other.cookie,
      OTHER_HIDDEN,
      "FAKE-CAPTURE-2",
    ]) {
      expect(everything).not.toContain(secret);
    }
    // The run's hidden-line column is never read. Only the recorded steps are sent.
    expect(sent.evidence.document.json).not.toContain('"hidden_line"');

    expect(sent.evidence.notes.length).toBeLessThanOrEqual(2000);
    expect(sent.evidence.notes).toContain(version.hash);
    expect(sent.evidence.notes).toContain(version.signature);
    expect(sent.evidence.notes).toContain(version.public_key);
    expect(sent.evidence.notes).toContain("FAKE-CAPTURE-1");
    expect(sent.evidence.document.name).toBe("allowance-evidence.pdf");
  });

  it("keeps the notes within 2,000 characters however many steps there are", () => {
    const notes = buildNotes({
      captureId: "CAP-1",
      amountCents: 3400,
      mandate: { version: 1, hash: "h".repeat(64), signature: "s".repeat(88), publicKey: "k".repeat(44) },
      rule: "never gift cards",
      cart: [{ productId: "p", name: "Paper towels", quantity: 1, unitPriceCents: 900, lineTotalCents: 900 }],
      totalCents: 900,
      steps: Array.from({ length: 80 }, (_, i) => `Step ${i + 1} ${"x".repeat(300)}`),
    });
    expect(notes.length).toBeLessThanOrEqual(2000);
    expect(notes).toMatch(/\d+ more recorded steps are in the attached document\.$/);
    expect(notes).toContain("h".repeat(64));
    expect(notes).toContain("1. Step 1");
  });
});

describe("the timeline's poll", () => {
  it("runs one poll, then skips until the gap has passed", async () => {
    const list = vi.fn(async () => []);
    const counting: DisputesPort = { ...port, listRecent: list, get: (id) => port.get(id), provideEvidence: (id, e) => port.provideEvidence(id, e), verifyWebhook: (a) => port.verifyWebhook(a) };
    expect(await syncDisputesThrottled(db, counting, clock)).not.toBeNull();
    expect(await syncDisputesThrottled(db, counting, clock)).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(await syncDisputesThrottled(db, counting, clock, 0)).not.toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not throw when PayPal cannot be read", async () => {
    const broken: DisputesPort = { ...port, listRecent: async () => { throw new Error("down"); }, get: port.get, provideEvidence: port.provideEvidence, verifyWebhook: port.verifyWebhook };
    expect(await syncDisputesThrottled(db, broken, clock, 0)).toBeNull();
  });
});

describe("the webhook", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ id: "WH-1", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "PP-D-1" }, ...over });
  const good = { "paypal-transmission-sig": FAKE_VALID_SIGNATURE };
  const run = (over: Partial<Parameters<typeof receiveWebhook>[0]> = {}) =>
    receiveWebhook({ getDb: async () => db, getPort: () => port, webhookId: "WH-ID", headers: good, rawBody: body(), clock, ...over });

  it("answers 503 and touches nothing when no webhook ID is set", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    const getPort = vi.fn(() => port);
    for (const id of [undefined, "", "   "]) {
      const res = await run({ webhookId: id, getPort, getDb: async () => { throw new Error("must not open the database"); } });
      expect(res.status).toBe(503);
    }
    expect(getPort).not.toHaveBeenCalled();
    expect(calls()).toBe(0);
    expect(await db.query("SELECT id FROM disputes")).toEqual([]);
  });

  it("answers 400 and changes nothing when PayPal does not confirm the message", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    expect((await run({ headers: { "paypal-transmission-sig": "forged" } })).status).toBe(400);
    expect((await run({ headers: {} })).status).toBe(400);
    expect(calls()).toBe(0);
    expect(await db.query("SELECT id FROM disputes")).toEqual([]);
  });

  it("handles a confirmed dispute event once, however many times PayPal delivers it", async () => {
    await charge({ hiddenLine: HIDDEN });
    setDisputes(script());
    const first = await run();
    expect(first).toEqual({ status: 200, body: { ok: true, outcome: "evidence_sent" } });
    const again = await run();
    expect(again).toEqual({ status: 200, body: { ok: true, outcome: "already_handled" } });
    expect(calls()).toBe(1);
  });

  it("ignores events that are not about disputes, and reads the dispute from PayPal, not the payload", async () => {
    setDisputes(script());
    expect(await run({ rawBody: body({ event_type: "PAYMENT.CAPTURE.COMPLETED" }) })).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(await db.query("SELECT id FROM disputes")).toEqual([]);
    // A payload claiming another capture ID changes nothing: PayPal's own record decides.
    await charge({ hiddenLine: HIDDEN });
    const res = await run({ rawBody: body({ resource: { dispute_id: "PP-D-1", disputed_transactions: [{ seller_transaction_id: "FAKE-CAPTURE-99" }] } }) });
    expect(res.body.outcome).toBe("evidence_sent");
    expect((await row()).capture_id).toBe("FAKE-CAPTURE-1");
  });

  it("answers 500 so PayPal delivers again when the dispute cannot be read", async () => {
    setDisputes();
    expect((await run()).status).toBe(500);
  });

  it("reads the dispute ID only from a dispute event with a plain ID", () => {
    expect(disputeIdFromEvent({ event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: { dispute_id: "PP-D-27803" } })).toBe("PP-D-27803");
    expect(disputeIdFromEvent({ event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: { dispute_id: "../x" } })).toBeNull();
    expect(disputeIdFromEvent({ event_type: "CUSTOMER.DISPUTE.RESOLVED", resource: {} })).toBeNull();
    expect(disputeIdFromEvent({ event_type: "PAYMENT.SALE.COMPLETED", resource: { dispute_id: "PP-D-1" } })).toBeNull();
    expect(disputeIdFromEvent(null)).toBeNull();
  });
});
