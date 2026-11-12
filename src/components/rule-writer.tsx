"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { type CardClause, MandateCard, type SignedDetails } from "@/components/mandate-card";
import { type CompiledRule, MAX_RULE_TEXT } from "@/lib/mandate/compile";
import { DEMO_RULE_TEXT, VISITOR_MAX_WEEKLY_BUDGET_CENTS } from "@/lib/mandate/demo-mandate";
import type { IntentMandate } from "@/lib/mandate/schema";
import { formatUsd } from "@/lib/money/cents";

export type RuleTarget = "mine" | "demo";

/** A signed mandate version as the browser needs it. */
export interface SignedView extends SignedDetails {
  mandate: IntentMandate;
}

interface Proposal {
  /** The words the proposal was read from. Signing uses these, not the box. */
  text: string;
  compiled: CompiledRule;
}

interface Failure {
  message: string;
}

type Decision = "accept" | "remove";

const TARGET_LABELS: Record<RuleTarget, string> = {
  mine: "Your rule, for your own tries on the home page",
  demo: "The demo parent's rule (owner only)",
};

const buttonPrimary =
  "rounded-xl bg-zinc-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";
const buttonSmall =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function RuleWriter({
  isOwner,
  current,
}: {
  isOwner: boolean;
  /** The rule each target holds right now. `demo` is set only for the owner. */
  current: { mine: SignedView; demo: SignedView | null };
}) {
  const [text, setText] = useState(DEMO_RULE_TEXT);
  const [target, setTarget] = useState<RuleTarget>("mine");
  const [currents, setCurrents] = useState(current);
  const [busy, setBusy] = useState<"read" | "sign" | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [signedNow, setSignedNow] = useState<{ target: RuleTarget; view: SignedView; notes: string[] } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const inFlight = useRef(false);
  // The buttons stay disabled until the page is interactive, so an early click cannot submit
  // the form as a plain page load.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_RULE_TEXT;
  const empty = trimmed.length === 0;
  const stale = proposal !== null && proposal.text !== trimmed;
  const pending = proposal ? proposal.compiled.notEnforced.filter((clause) => !decisions[clause]) : [];
  const shownCurrent = target === "demo" ? currents.demo : currents.mine;

  async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
    const res = await fetch("/api/rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, data };
  }

  function chooseTarget(next: RuleTarget) {
    setTarget(next);
    setProposal(null);
    setDecisions({});
    setSignedNow(null);
    setFailure(null);
  }

  async function readRule() {
    if (inFlight.current || empty || tooLong) return;
    inFlight.current = true;
    setBusy("read");
    setFailure(null);
    try {
      const result = await post({ action: "compile", text: trimmed, target });
      if (!result.ok || !result.data?.compiled) {
        setProposal(null);
        setDecisions({});
        setFailure({ message: typeof result.data?.error === "string" ? result.data.error : "Could not read this rule" });
        return;
      }
      setProposal({ text: trimmed, compiled: result.data.compiled as CompiledRule });
      setDecisions({});
      setSignedNow(null);
    } catch {
      setProposal(null);
      setFailure({ message: "The connection dropped. Nothing was changed." });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function signRule() {
    if (inFlight.current || !proposal || stale || pending.length > 0) return;
    inFlight.current = true;
    setBusy("sign");
    setFailure(null);
    try {
      // A removed clause is left out of what is posted. What remains is exactly what was accepted.
      const accepted = proposal.compiled.notEnforced.filter((clause) => decisions[clause] === "accept");
      const result = await post({
        action: "sign",
        text: proposal.text,
        target,
        compiled: { ...proposal.compiled, notEnforced: accepted },
        accepted,
      });
      const signed = result.data?.signed as SignedView | undefined;
      if (!result.ok || !signed) {
        setFailure({ message: typeof result.data?.error === "string" ? result.data.error : "The rule was not signed." });
        return;
      }
      setCurrents((previous) => (target === "demo" ? { ...previous, demo: signed } : { ...previous, mine: signed }));
      setSignedNow({ target, view: signed, notes: proposal.compiled.notes });
      setProposal(null);
      setDecisions({});
    } catch {
      setFailure({ message: "The connection dropped. Nothing was changed." });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function decide(clause: string, decision: Decision | null) {
    setDecisions((previous) => {
      const next = { ...previous };
      if (decision) next[clause] = decision;
      else delete next[clause];
      return next;
    });
  }

  const clauseCards: CardClause[] = proposal
    ? proposal.compiled.notEnforced.map((clause) => {
        const decision = decisions[clause];
        return {
          text: clause,
          status: decision === "accept" ? "accepted" : decision === "remove" ? "removed" : "pending",
          actions: decision ? (
            <button type="button" className={buttonSmall} disabled={!hydrated || busy !== null} aria-label={`Undo for “${clause}”`} onClick={() => decide(clause, null)}>
              Undo
            </button>
          ) : (
            <>
              <button type="button" className={buttonSmall} disabled={!hydrated || busy !== null} aria-label={`Accept “${clause}” as not enforced`} onClick={() => decide(clause, "accept")}>
                Accept
              </button>
              <button type="button" className={buttonSmall} disabled={!hydrated || busy !== null} aria-label={`Remove “${clause}” from the rule`} onClick={() => decide(clause, "remove")}>
                Remove
              </button>
            </>
          ),
        };
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      {isOwner && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Whose rule is this?</legend>
          {(Object.keys(TARGET_LABELS) as RuleTarget[]).map((key) => (
            <label key={key} className="flex items-center gap-2 text-base">
              <input
                type="radio"
                name="rule-target"
                value={key}
                checked={target === key}
                disabled={!hydrated || busy !== null}
                onChange={() => chooseTarget(key)}
              />
              {TARGET_LABELS[key]}
            </label>
          ))}
        </fieldset>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void readRule();
        }}
      >
        <label htmlFor="rule-text" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {target === "demo" ? "The demo parent's rule, in plain English" : "Your rule, in plain English"}
        </label>
        <textarea
          id="rule-text"
          name="rule-text"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="rule-text-count"
          className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="submit" disabled={!hydrated || busy !== null || empty || tooLong} className={buttonPrimary}>
            {busy === "read" ? "Reading…" : "Read my rule"}
          </button>
          <span
            id="rule-text-count"
            className={`text-sm tabular-nums ${tooLong ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-500"}`}
          >
            {tooLong ? `${trimmed.length} of ${MAX_RULE_TEXT} characters. Shorten your rule.` : `${trimmed.length} / ${MAX_RULE_TEXT}`}
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          In this public demo a weekly budget above {formatUsd(VISITOR_MAX_WEEKLY_BUDGET_CENTS)} is lowered to {formatUsd(VISITOR_MAX_WEEKLY_BUDGET_CENTS)}.
        </p>
      </form>

      <section aria-label="Result" aria-live="polite" className="flex flex-col gap-4">
        {failure && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="font-medium">{failure.message}</p>
            <p className="text-sm">Your earlier rule is unchanged.</p>
          </div>
        )}

        {proposal && (
          <>
            <MandateCard
              testId="proposed-card"
              heading="Here is how the store will read your rule"
              words={proposal.text}
              rules={proposal.compiled.rules}
              notes={proposal.compiled.notes}
              clauses={clauseCards}
            />
            {pending.length > 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Accept or remove {pending.length === 1 ? "the clause" : "each clause"} under Not enforced to sign.
              </p>
            )}
            {stale && (
              <p className="text-sm text-amber-800 dark:text-amber-300">You changed your words. Press Read my rule again before signing.</p>
            )}
            <div>
              <button
                type="button"
                className={buttonPrimary}
                disabled={!hydrated || busy !== null || stale || pending.length > 0}
                onClick={() => void signRule()}
              >
                {busy === "sign" ? "Signing…" : "Sign this rule"}
              </button>
            </div>
          </>
        )}

        {signedNow && (
          <>
            <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {signedNow.target === "demo"
                ? `Signed. The demo parent's rule is now version ${signedNow.view.version}.`
                : `Signed. Your tries on the home page now use this rule (version ${signedNow.view.version}).`}{" "}
              <Link href={signedNow.target === "demo" ? "/mandate" : "/"} className="underline underline-offset-4">
                {signedNow.target === "demo" ? "See the demo parent's rule" : "Try it on the home page"}
              </Link>
            </p>
            <MandateCard
              testId="signed-card"
              heading="Your signed rule"
              words={signedNow.view.mandate.natural_language_description}
              rules={signedNow.view.mandate.allowance_rules}
              notes={signedNow.notes}
              clauses={signedNow.view.mandate.not_enforced.map((clause) => ({ text: clause, status: "accepted" as const }))}
              signed={signedNow.view}
            />
          </>
        )}

        {!proposal && !signedNow && shownCurrent && (
          <MandateCard
            testId="current-card"
            heading={target === "demo" ? "The demo parent's rule right now" : "Your rule right now"}
            words={shownCurrent.mandate.natural_language_description}
            rules={shownCurrent.mandate.allowance_rules}
            clauses={shownCurrent.mandate.not_enforced.map((clause) => ({ text: clause, status: "accepted" as const }))}
            signed={shownCurrent}
          />
        )}
      </section>
    </div>
  );
}
