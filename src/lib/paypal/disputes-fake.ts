// A fake disputes service for test mode (KTD5). The disputes it knows come from the test hook
// "disputes", and it counts every evidence upload. It keeps no other state: a test that wants a
// dispute to move on changes the hook.
import { getTestHook } from "@/lib/test-hooks";
import type { DisputeDetail, DisputeSummary, DisputesPort, EvidenceInput, EvidenceResult } from "./disputes";

export interface FakeDisputeScript {
  id: string;
  captureId: string;
  status: string;
  withEvidenceLink: boolean;
  /** PayPal answers the evidence upload with a refusal. */
  refuseEvidence?: boolean;
  /** Defaults to `withEvidenceLink`. Set false for a link without a request for the seller. */
  requestedFromSeller?: boolean;
}

export const FAKE_VALID_SIGNATURE = "FAKE-VALID-SIGNATURE";

interface FakeState {
  provideEvidenceCalls: number;
  lastEvidence: { disputeId: string; evidence: EvidenceInput } | null;
}

const state = ((globalThis as Record<string, unknown>).__allowanceFakeDisputes ??= {
  provideEvidenceCalls: 0,
  lastEvidence: null,
}) as FakeState;

/** For tests: how many evidence uploads the fake has received in this process. */
export function fakeDisputeCalls(): FakeState {
  return state;
}

export function resetFakeDisputeCalls(): void {
  state.provideEvidenceCalls = 0;
  state.lastEvidence = null;
}

function scripts(): FakeDisputeScript[] {
  return getTestHook<FakeDisputeScript[]>("disputes") ?? [];
}

export class FakeDisputes implements DisputesPort {
  async listRecent(): Promise<DisputeSummary[]> {
    return scripts().map((s) => ({ id: s.id, status: s.status }));
  }

  async get(id: string): Promise<DisputeDetail> {
    const s = scripts().find((x) => x.id === id);
    if (!s) throw new Error("RESOURCE_NOT_FOUND");
    return {
      id: s.id,
      status: s.status,
      reason: "UNAUTHORISED",
      captureIds: [s.captureId],
      hasProvideEvidenceLink: s.withEvidenceLink,
      evidenceRequestedFromSeller: s.requestedFromSeller ?? s.withEvidenceLink,
    };
  }

  async provideEvidence(id: string, evidence: EvidenceInput): Promise<EvidenceResult> {
    state.provideEvidenceCalls++;
    state.lastEvidence = { disputeId: id, evidence };
    if (scripts().find((x) => x.id === id)?.refuseEvidence) return { ok: false, reason: "EVIDENCE_NOT_ACCEPTED" };
    return { ok: true };
  }

  /** True only for the header value a test sends on purpose. */
  async verifyWebhook(args: { headers: Record<string, string | undefined> }): Promise<boolean> {
    return args.headers["paypal-transmission-sig"] === FAKE_VALID_SIGNATURE;
  }
}
