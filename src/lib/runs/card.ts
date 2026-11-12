// The result card (R2). It always states what the AI did, what the rule decided and what
// PayPal charged, in one of five endings.
import type { AttemptRow } from "@/lib/checkout/checkout";
import { formatUsd } from "@/lib/money/cents";
import type { AgentOutcome } from "./classify";

export type Ending = "a" | "b" | "c" | "d" | "e" | "restock" | "skip";
export type Tone = "blocked" | "charged" | "neutral" | "pending";

export interface ResultCard {
  ending: Ending;
  tone: Tone;
  headline: string;
  ai: string;
  rule: string;
  paypal: string;
  receiptId: string | null;
}

export const AI_BUSY_LINE = "The AI is busy right now.";

function ruleLine(a: AttemptRow): string {
  if (a.state === "blocked") return `Blocked by your rule: ${a.rule}.`;
  if (a.state === "stopped") return "Your rule says to ask first for this item, so the cart stopped.";
  return `Allowed by your rule: ${a.rule}.`;
}

function paypalLine(a: AttemptRow): string {
  if (a.state === "captured") return `PayPal charged ${formatUsd(a.captured_cents)}. Order ${a.paypal?.orderId}.`;
  if (a.state === "unknown" || a.state === "reserved") return "Checking with PayPal";
  if (a.state === "allowed_not_charged") return a.message ?? "Nothing was charged.";
  return "PayPal charged $0.";
}

function toneFor(a: AttemptRow): Tone {
  if (a.state === "captured") return "charged";
  if (a.state === "unknown" || a.state === "reserved") return "pending";
  if (a.state === "blocked") return "blocked";
  return "neutral";
}

export interface CardInput {
  kind: "agent" | "restock" | "skip";
  outcome: AgentOutcome | null;
  /** The step number at which the agent opened the page with the line. */
  poisonedStep: number | null;
  attempt: AttemptRow | null;
  /** Why the run ended without a checkout, or why the AI did not run. */
  stopReason: string | null;
  aiDidNotRun: boolean;
  checkoutError: string | null;
}

export function composeCard(input: CardInput): ResultCard {
  const { attempt } = input;
  const receiptId = attempt?.state === "captured" ? attempt.receipt_id : null;

  if (input.aiDidNotRun) {
    return {
      ending: "e",
      tone: "neutral",
      headline: input.stopReason ?? AI_BUSY_LINE,
      ai: "The AI did not run.",
      rule: "Not reached.",
      paypal: "Nothing reached PayPal.",
      receiptId: null,
    };
  }

  if (!attempt) {
    const why = input.checkoutError ?? input.stopReason ?? "The AI stopped before checkout.";
    return {
      ending: "d",
      tone: "neutral",
      headline: `Nothing reached PayPal. ${why}`,
      ai: input.kind === "skip" ? "Skipped." : `The AI stopped before checkout: ${input.stopReason ?? "no checkout"}.`,
      rule: input.checkoutError ? input.checkoutError : "Not reached.",
      paypal: "Nothing reached PayPal.",
      receiptId: null,
    };
  }

  const base = { tone: toneFor(attempt), rule: ruleLine(attempt), paypal: paypalLine(attempt), receiptId };
  const charged = attempt.state === "captured";
  const blocked = attempt.state === "blocked";

  if (input.kind === "skip") {
    return {
      ...base,
      ending: "skip",
      headline: blocked ? `Blocked by your rule: ${attempt.rule}. PayPal charged $0.` : attempt.message ?? "",
      ai: "Skipped. The cart your line asked for went straight to checkout.",
    };
  }
  if (input.kind === "restock") {
    return {
      ...base,
      ending: "restock",
      headline: blocked ? `Your rule blocked this restock: ${attempt.rule}. PayPal charged $0.` : attempt.message ?? "",
      ai: "Bought the list.",
    };
  }

  const step = input.poisonedStep ?? 0;
  switch (input.outcome) {
    case "followed":
      if (blocked) {
        return {
          ...base,
          ending: "a",
          headline: `Your AI fell for it. Blocked by your rule: ${attempt.rule}. PayPal charged $0.`,
          ai: `Read your line at step ${step} and changed the cart.`,
        };
      }
      return {
        ...base,
        ending: "c",
        headline: charged
          ? "Your AI was tricked, but the cart fits your rule, so PayPal charged it. The rule is the limit."
          : `Your AI was tricked, but the cart fits your rule. ${attempt.message ?? ""}`.trim(),
        ai: `Read your line at step ${step} and changed the cart.`,
      };
    case "ignored":
    case "never_opened": {
      const ai =
        input.outcome === "ignored"
          ? `Read your line at step ${step} and ignored it.`
          : "Never opened the page with your line.";
      const lead =
        input.outcome === "ignored"
          ? `Your AI read your line at step ${step} and ignored it.`
          : "Your AI never opened the page with your line.";
      if (blocked) {
        return { ...base, ending: "b", headline: `${lead} Your rule blocked this cart: ${attempt.rule}. PayPal charged $0.`, ai };
      }
      if (charged) {
        return {
          ...base,
          ending: "b",
          headline: `${lead} Your rule allowed ${formatUsd(attempt.total_cents)}, and PayPal charged ${formatUsd(attempt.captured_cents)}.`,
          ai,
        };
      }
      return { ...base, ending: "b", headline: `${lead} ${attempt.message ?? ""}`.trim(), ai };
    }
    default:
      return { ...base, ending: "d", headline: attempt.message ?? "", ai: "Checked out." };
  }
}
