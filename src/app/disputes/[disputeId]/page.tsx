import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { type DisputeRow, syncDisputesThrottled } from "@/lib/disputes/handle";
import { getDisputesPort } from "@/lib/disputes/port";
import { type DisputeView, buildTimeline, formatWhen, statusLabel } from "@/lib/disputes/timeline";
import { now } from "@/lib/ports";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Dispute · Allowance" };

export default function DisputePage({ params }: { params: Promise<{ disputeId: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/disputes" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← All disputes
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Loading the dispute…</p>}>
        <Timeline params={params} />
      </Suspense>
    </main>
  );
}

const iso = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null);

async function Timeline({ params }: { params: Promise<{ disputeId: string }> }) {
  await connection();
  const { disputeId } = await params;
  const db = await getDb();
  const load = async () =>
    (
      await db.query<DisputeRow & { amount_cents: number | null }>(
        `SELECT d.*, a.captured_cents AS amount_cents FROM disputes d LEFT JOIN attempts a ON a.id = d.attempt_id WHERE d.id = $1`,
        [disputeId],
      )
    )[0];
  let row = await load();
  if (!row) notFound();

  // While the dispute is open, the page asks PayPal what changed. At most one poll runs at a
  // time and no more often than every 15 seconds, so open pages cannot flood PayPal. A slow
  // PayPal never holds the page for more than 4 seconds.
  if (row.status !== "RESOLVED") {
    try {
      await Promise.race([
        syncDisputesThrottled(db, getDisputesPort(), now),
        new Promise((resolve) => setTimeout(resolve, 4_000)),
      ]);
      row = (await load()) ?? row;
    } catch {
      // The stored state is still shown.
    }
  }

  const view: DisputeView = {
    status: row.status,
    matched: row.matched,
    captureId: row.capture_id,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    firstSeenAt: iso(row.first_seen_at)!,
    evidenceClaimedAt: iso(row.evidence_claimed_at),
    evidenceSentAt: iso(row.evidence_sent_at),
    evidenceError: row.evidence_error,
    history: (Array.isArray(row.raw_status_history) ? row.raw_status_history : []).map((h) => ({ status: h.status, at: h.at })),
  };
  const steps = buildTimeline(view);

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Dispute · PayPal sandbox</p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{row.id}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">PayPal status: {statusLabel(row.status)}</p>
      </header>
      <ol data-testid="dispute-timeline" aria-label="Dispute timeline" className="flex flex-col gap-3 border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
        {steps.map((s) => (
          <li key={s.key} data-testid={`step-${s.key}`} className="flex flex-col gap-0.5">
            <span className="font-medium">{s.title}</span>
            {s.at && <time dateTime={s.at} className="text-sm text-zinc-500">{formatWhen(s.at)}</time>}
            {s.detail && <span className="text-sm text-zinc-600 dark:text-zinc-400">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {view.history.length > 1 && (
        <section aria-label="PayPal status history" className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">PayPal status history</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400">
            {view.history.map((h) => (
              <li key={`${h.status}-${h.at}`}>
                {statusLabel(h.status)} · {formatWhen(h.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {row.status !== "RESOLVED" && <AutoRefresh />}
    </article>
  );
}
