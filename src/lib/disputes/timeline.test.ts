// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type DisputeView, buildTimeline, evidenceSummary, secondsBetween } from "./timeline";

const SEEN = "2026-11-12T15:00:00.000Z";
const base: DisputeView = {
  status: "WAITING_FOR_SELLER_RESPONSE",
  matched: true,
  captureId: "FAKE-CAPTURE-1",
  amountCents: 3400,
  firstSeenAt: SEEN,
  evidenceClaimedAt: null,
  evidenceSentAt: null,
  evidenceError: null,
  history: [{ status: "WAITING_FOR_SELLER_RESPONSE", at: SEEN }],
};
const keys = (v: DisputeView) => buildTimeline(v).map((s) => s.key);

describe("the dispute timeline", () => {
  it("shows only the states the dispute has reached", () => {
    expect(keys(base)).toEqual(["seen", "matched", "waiting"]);
    expect(keys({ ...base, matched: false })).toEqual(["seen", "unmatched"]);
    expect(keys({ ...base, evidenceSentAt: "2026-11-12T15:00:03.000Z" })).toEqual(["seen", "matched", "evidence_sent"]);
  });

  it("gives the seconds from seen to evidence sent", () => {
    const sent = buildTimeline({ ...base, evidenceSentAt: "2026-11-12T15:00:42.400Z" }).find((s) => s.key === "evidence_sent")!;
    expect(sent.title).toBe("Evidence sent");
    expect(sent.detail).toContain("42 seconds after");
    expect(sent.at).toBe("2026-11-12T15:00:42.400Z");
    const one = buildTimeline({ ...base, evidenceSentAt: "2026-11-12T15:00:01.000Z" }).find((s) => s.key === "evidence_sent")!;
    expect(one.detail).toContain("1 second after");
    expect(secondsBetween(SEEN, "2026-11-12T14:00:00Z")).toBe(0);
  });

  it("shows PayPal's reason when it refused", () => {
    const step = buildTimeline({ ...base, evidenceError: "ACTION_NOT_ALLOWED", evidenceClaimedAt: SEEN }).find((s) => s.key === "evidence_refused")!;
    expect(step.title).toBe("PayPal refused the evidence");
    expect(step.detail).toContain("ACTION_NOT_ALLOWED");
  });

  it("adds under review and resolved, each with its date, after the evidence", () => {
    const history = [
      { status: "WAITING_FOR_SELLER_RESPONSE", at: SEEN },
      { status: "UNDER_REVIEW", at: "2026-11-12T15:01:00.000Z" },
      { status: "RESOLVED", at: "2026-11-12T15:02:00.000Z" },
    ];
    const steps = buildTimeline({ ...base, status: "RESOLVED", evidenceSentAt: "2026-11-12T15:00:02.000Z", history });
    expect(steps.map((s) => s.key)).toEqual(["seen", "matched", "evidence_sent", "under_review", "resolved"]);
    expect(steps.at(-1)!.at).toBe("2026-11-12T15:02:00.000Z");
  });

  it("says no evidence was sent when the dispute resolved without a request", () => {
    expect(keys({ ...base, status: "RESOLVED", history: [...base.history, { status: "RESOLVED", at: "2026-11-12T15:02:00.000Z" }] })).toEqual([
      "seen",
      "matched",
      "no_evidence",
      "resolved",
    ]);
  });

  it("summarises the evidence state for the list", () => {
    expect(evidenceSummary(base)).toBe("Waiting for PayPal to ask for evidence");
    expect(evidenceSummary({ ...base, matched: false })).toBe("Unmatched, no evidence sent");
    expect(evidenceSummary({ ...base, evidenceSentAt: SEEN })).toBe("Evidence sent");
    expect(evidenceSummary({ ...base, evidenceError: "X" })).toBe("PayPal refused the evidence");
  });
});
