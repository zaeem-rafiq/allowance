// What the dispute timeline shows (R26). Only states the dispute has reached are listed, each
// with its date, so an unreached stage is never drawn as if it had happened.
import { formatUsd } from "@/lib/money/cents";

export type StepKey =
  | "seen"
  | "matched"
  | "unmatched"
  | "waiting"
  | "evidence_sent"
  | "evidence_refused"
  | "no_evidence"
  | "under_review"
  | "resolved";

export interface TimelineStep {
  key: StepKey;
  title: string;
  detail: string | null;
  /** ISO time, or null when the state has no date of its own. */
  at: string | null;
}

export interface DisputeView {
  status: string;
  matched: boolean;
  captureId: string | null;
  /** The matched charge's amount, from the stored attempt. */
  amountCents: number | null;
  firstSeenAt: string;
  evidenceClaimedAt: string | null;
  evidenceSentAt: string | null;
  evidenceError: string | null;
  history: { status: string; at: string }[];
}

export function secondsBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildTimeline(v: DisputeView): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "seen", title: "Seen", detail: "Allowance first saw this dispute in PayPal.", at: v.firstSeenAt },
  ];
  steps.push(
    v.matched
      ? {
          key: "matched",
          title: "Matched",
          detail: `Capture ${v.captureId ?? "unknown"}${v.amountCents !== null ? ` is an Allowance charge of ${formatUsd(v.amountCents)}` : " is an Allowance charge"}.`,
          at: v.firstSeenAt,
        }
      : {
          key: "unmatched",
          title: "Unmatched",
          detail: `${v.captureId ? `Capture ${v.captureId} is` : "No capture ID"} not an Allowance charge, so no evidence was sent.`,
          at: v.firstSeenAt,
        },
  );
  const resolvedAt = v.history.find((h) => h.status === "RESOLVED")?.at ?? null;
  if (v.matched) {
    if (v.evidenceSentAt) {
      const secs = secondsBetween(v.firstSeenAt, v.evidenceSentAt);
      steps.push({
        key: "evidence_sent",
        title: "Evidence sent",
        detail: `${plural(secs, "second")} after Allowance first saw the dispute. It holds the signed rule, the cart and the agent's steps.`,
        at: v.evidenceSentAt,
      });
    } else if (v.evidenceError) {
      steps.push({
        key: "evidence_refused",
        title: "PayPal refused the evidence",
        detail: `Reason: ${v.evidenceError}. Allowance does not send it again.`,
        at: v.evidenceClaimedAt,
      });
    } else if (resolvedAt) {
      steps.push({
        key: "no_evidence",
        title: "No evidence was sent",
        detail: "PayPal never asked for evidence before the dispute was resolved.",
        at: null,
      });
    } else {
      steps.push({
        key: "waiting",
        title: "Waiting for PayPal to ask for evidence",
        detail: "Allowance sends the evidence as soon as PayPal asks for it.",
        at: null,
      });
    }
  }
  const underReviewAt = v.history.find((h) => h.status === "UNDER_REVIEW")?.at ?? null;
  if (underReviewAt) steps.push({ key: "under_review", title: "Under review", detail: "PayPal is reviewing the dispute.", at: underReviewAt });
  if (resolvedAt) steps.push({ key: "resolved", title: "Resolved", detail: "PayPal closed the dispute.", at: resolvedAt });
  return steps;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer",
  WAITING_FOR_SELLER_RESPONSE: "Waiting for the seller",
  UNDER_REVIEW: "Under review",
  RESOLVED: "Resolved",
  OTHER: "Other",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** "Nov 12, 2026, 3:04:05 PM UTC". */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
}

/** The short line the list page shows for the evidence state. */
export function evidenceSummary(v: Pick<DisputeView, "matched" | "evidenceSentAt" | "evidenceError" | "status">): string {
  if (!v.matched) return "Unmatched, no evidence sent";
  if (v.evidenceSentAt) return "Evidence sent";
  if (v.evidenceError) return "PayPal refused the evidence";
  if (v.status === "RESOLVED") return "Resolved, no evidence sent";
  return "Waiting for PayPal to ask for evidence";
}
