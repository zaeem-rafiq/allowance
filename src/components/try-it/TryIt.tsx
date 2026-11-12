"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import type { ResultCard } from "@/lib/runs/card";
import { DEFAULT_HIDDEN_LINE, MAX_LINE_CHARS, describeExtras, forcedCart } from "@/lib/runs/forced-cart";
import type { RunKind } from "@/lib/runs/run";

interface Step {
  seq: number;
  kind: "tool" | "thought" | "system";
  text: string;
}

export function TryIt() {
  const [line, setLine] = useState(DEFAULT_HIDDEN_LINE);
  const [running, setRunning] = useState<RunKind | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [card, setCard] = useState<ResultCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [cap, setCap] = useState(false);
  const inFlight = useRef(false);
  const hydrated = useHydrated();

  const tooLong = line.length > MAX_LINE_CHARS;
  const empty = line.trim().length === 0;
  const skipPreview = useMemo(() => {
    const f = forcedCart(line);
    return f.usedExample
      ? "Your line names no store product, so this sends the example cart: the list plus one $500 gift card."
      : `Sends ${describeExtras(f.cart)}.`;
  }, [line]);

  // While an ask-first request waits for Approve or Decline, a new run would leave its held
  // amount orphaned, so the run buttons wait for the decision.
  const approvalOpen = card?.approval != null;

  async function start(kind: RunKind) {
    if (inFlight.current || approvalOpen) return;
    if ((kind === "agent" || kind === "skip") && (empty || tooLong)) return;
    inFlight.current = true;
    setRunning(kind);
    setSteps([]);
    setCard(null);
    setError(null);
    setRunId(null);
    setCap(false);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, hiddenLine: kind === "agent" || kind === "skip" ? line : null }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        if (body?.cap) setCap(true);
        else setError(body?.error ?? "Something went wrong. Nothing was charged.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const raw = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!raw.trim()) continue;
          const event = JSON.parse(raw);
          if (event.type === "start") setRunId(event.runId);
          if (event.type === "step") setSteps((s) => [...s, event.step]);
          if (event.type === "done") setCard(event.card);
        }
      }
    } catch {
      setError("The connection dropped. Open your spend history to see whether anything was charged.");
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start("agent");
        }}
      >
        <label htmlFor="hidden-line" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          A hidden line on one product page. The AI reads it while it shops.
        </label>
        <textarea
          id="hidden-line"
          name="hidden-line"
          rows={3}
          value={line}
          onChange={(e) => setLine(e.target.value)}
          aria-describedby="hidden-line-count"
          className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 font-mono text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="submit"
            disabled={!hydrated || approvalOpen || running !== null || empty || tooLong}
            className="rounded-xl bg-zinc-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {running === "agent" ? "Running…" : "Try it"}
          </button>
          <span
            id="hidden-line-count"
            className={`text-sm tabular-nums ${tooLong ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-500"}`}
          >
            {tooLong ? `${line.length} of ${MAX_LINE_CHARS} characters. Shorten your line.` : `${line.length} / ${MAX_LINE_CHARS}`}
          </span>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <button
            type="button"
            onClick={() => void start("restock")}
            disabled={!hydrated || approvalOpen || running !== null}
            className="self-start text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-700 disabled:opacity-50 dark:text-zinc-300"
          >
            Try a normal restock
          </button>
          <button
            type="button"
            onClick={() => void start("ask_first")}
            disabled={!hydrated || approvalOpen || running !== null}
            className="self-start text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-700 disabled:opacity-50 dark:text-zinc-300"
          >
            Try a restock with a $52 item
          </button>
          <button
            type="button"
            onClick={() => void start("skip")}
            disabled={!hydrated || approvalOpen || running !== null || empty || tooLong}
            className="self-start text-left text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-700 disabled:opacity-50 dark:text-zinc-300"
          >
            Skip the AI: send the cart your line asked for
          </button>
          <span className="text-zinc-500">{skipPreview}</span>
        </div>
      </form>

      <section aria-label="Result" aria-live="polite" className="min-h-40">
        {cap ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-300 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-xl font-semibold">You have used today&apos;s live tries.</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Skip the AI still works: it sends the cart your line asked for straight to checkout, with no AI call. Below
              is a real run recorded earlier.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-zinc-300 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-lg font-semibold">{error}</p>
          </div>
        ) : card ? (
          <Card card={card} runId={runId} onDecided={setCard} onSkip={running || approvalOpen ? undefined : () => void start("skip")} />
        ) : running ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-500 dark:border-zinc-700">
            {running === "skip" ? "Sending the cart to checkout…" : "The AI is shopping. Its steps appear below as they happen."}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-500 dark:border-zinc-700">
            Your result appears here: what the AI did, what your rule decided, and what PayPal charged.
          </div>
        )}
      </section>

      {(cap || card?.ending === "e") && <RecordedRunView />}

      {steps.length > 0 && (
        <section aria-label="What the AI did" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What the AI did</h2>
          <ol className="flex flex-col gap-1.5">
            {steps.map((s) => (
              <li key={s.seq} className="flex gap-3 text-sm">
                <span className="w-6 shrink-0 text-right tabular-nums text-zinc-400">{s.seq}</span>
                <span
                  className={
                    s.text.includes("hidden line")
                      ? "font-medium text-red-700 dark:text-red-400"
                      : s.kind === "thought"
                        ? "italic text-zinc-600 dark:text-zinc-400"
                        : "text-zinc-800 dark:text-zinc-200"
                  }
                >
                  {s.text}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

interface RecordedRun {
  recordedAt: string;
  hiddenLine: string | null;
  card: ResultCard;
  steps: Step[];
}

function RecordedRunView() {
  const [run, setRun] = useState<RecordedRun | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/runs/featured")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => live && setRun(body?.run ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!run) return null;
  const date = new Date(run.recordedAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "America/Chicago" });
  return (
    <section aria-label="Recorded run" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Recorded on {date}</h2>
      {run.hiddenLine && <p className="font-mono text-sm text-zinc-600 dark:text-zinc-400">Hidden line: {run.hiddenLine}</p>}
      <Card card={run.card} runId={null} />
      <ol className="flex flex-col gap-1.5">
        {run.steps.map((s) => (
          <li key={s.seq} className="flex gap-3 text-sm">
            <span className="w-6 shrink-0 text-right tabular-nums text-zinc-400">{s.seq}</span>
            <span className="text-zinc-700 dark:text-zinc-300">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const TONES: Record<ResultCard["tone"], string> = {
  blocked: "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  charged: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  pending: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  neutral: "border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
};

const DROPPED =
  "The connection dropped, so this page cannot tell whether PayPal was charged. Tap Approve again to see the result: it can only charge once.";

function ApprovalCard({ approval, onDecided }: { approval: NonNullable<ResultCard["approval"]>; onDecided: (c: ResultCard) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "approve" | "decline") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: approval.attemptId, decision }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.card) onDecided(body.card);
      else setError(body?.error ?? DROPPED);
    } catch {
      setError(DROPPED);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="dialog"
      aria-label="Approval request"
      className="mx-auto w-full max-w-xs rounded-[2rem] border-4 border-zinc-900 bg-white p-4 text-zinc-900 shadow-lg dark:border-zinc-200 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Allowance · now</p>
      <p className="mt-2 font-semibold">Approve this purchase?</p>
      <p className="mt-1 text-sm">
        Your AI wants to buy {approval.items}. Your rule says to ask you first for anything over your limit.
      </p>
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("decline")}
          className="rounded-xl border border-zinc-300 py-2 font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          Decline
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("approve")}
          className="rounded-xl bg-zinc-900 py-2 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function Card({
  card,
  runId,
  onDecided,
  onSkip,
}: {
  card: ResultCard;
  runId: string | null;
  onDecided?: (c: ResultCard) => void;
  onSkip?: () => void;
}) {
  return (
    <div data-testid="result-card" className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-sm ${TONES[card.tone]}`}>
      <p className="text-xl font-semibold leading-snug sm:text-2xl">{card.headline}</p>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="font-medium opacity-70">The AI</dt>
        <dd>{card.ai}</dd>
        <dt className="font-medium opacity-70">Your rule</dt>
        <dd>{card.rule}</dd>
        <dt className="font-medium opacity-70">PayPal</dt>
        <dd>{card.paypal}</dd>
      </dl>
      {card.approval && onDecided && <ApprovalCard approval={card.approval} onDecided={onDecided} />}
      {onSkip && (card.ending === "b" || card.ending === "e") && (
        <button
          type="button"
          onClick={onSkip}
          className="self-start rounded-lg border border-current px-3 py-1.5 text-sm font-medium opacity-90 hover:opacity-100"
        >
          {card.ending === "b" ? "Now pretend it was fooled: Skip the AI" : "Skip the AI: send the cart your line asked for"}
        </button>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {card.receiptId && (
          <Link href={`/receipts/${card.receiptId}`} className="font-medium underline underline-offset-4">
            Open the receipt
          </Link>
        )}
        {runId && card.ending !== "skip" && card.ending !== "restock" && card.ending !== "e" && (
          <Link href={`/store/paper-towels?run=${runId}`} className="underline underline-offset-4 opacity-80">
            See the page with your line
          </Link>
        )}
      </div>
    </div>
  );
}
