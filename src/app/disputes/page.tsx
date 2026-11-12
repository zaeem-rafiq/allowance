import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import type { DisputeRow } from "@/lib/disputes/handle";
import { evidenceSummary, formatWhen, statusLabel } from "@/lib/disputes/timeline";
import { currentOwner } from "@/lib/owner/guard";
import { ownerConfigured } from "@/lib/owner/session";

export const metadata: Metadata = { title: "Disputes · Allowance" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DisputesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance · PayPal sandbox</p>
        <h1 className="text-3xl font-semibold tracking-tight">Disputes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          When a buyer disputes a charge, Allowance finds it by the PayPal capture ID it stored. When PayPal asks the seller
          for evidence, Allowance sends the signed rule, the cart and the agent&apos;s steps, once.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading disputes…</p>}>
        <DisputeList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type ListRow = DisputeRow & { amount_cents: number | null };

async function DisputeList({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const owner = ownerConfigured() ? await currentOwner() : null;
  const check = typeof params.check === "string" ? params.check : null;
  const seen = typeof params.seen === "string" && /^\d{1,4}$/.test(params.seen) ? Number(params.seen) : null;
  const sent = typeof params.sent === "string" && /^\d{1,4}$/.test(params.sent) ? Number(params.sent) : null;

  let rows: ListRow[] | null = null;
  try {
    const db = await getDb();
    rows = await db.query<ListRow>(
      `SELECT d.*, a.captured_cents AS amount_cents FROM disputes d LEFT JOIN attempts a ON a.id = d.attempt_id
       ORDER BY d.first_seen_at DESC LIMIT 50`,
    );
  } catch {
    rows = null;
  }

  return (
    <section className="flex flex-col gap-4">
      {check === "done" && seen !== null && sent !== null && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Checked PayPal. It lists {seen} {seen === 1 ? "dispute" : "disputes"}. Allowance sent evidence for {sent}.
        </p>
      )}
      {check === "failed" && (
        <p role="status" className="rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950 dark:text-red-200">
          Allowance could not read PayPal&apos;s disputes. Nothing changed. Try again in a minute.
        </p>
      )}
      {owner && (
        <form method="post" action="/api/disputes/check">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Check PayPal for disputes
          </button>
        </form>
      )}
      {rows === null ? (
        <p className="text-red-700 dark:text-red-400">The database could not be reached.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No disputes yet. To try one, open a dispute on an Allowance charge from the sandbox buyer account in PayPal&apos;s
          Resolution Center, and choose &ldquo;unauthorized&rdquo; as the reason.
        </p>
      ) : (
        <ul aria-label="Disputes" className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <Link href={`/disputes/${encodeURIComponent(r.id)}`} className="flex flex-col gap-1 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="break-all font-mono font-medium">{r.id}</span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{statusLabel(r.status)}</span>
                </span>
                <span className="text-sm">
                  {evidenceSummary({
                    matched: r.matched,
                    evidenceSentAt: r.evidence_sent_at ? new Date(r.evidence_sent_at).toISOString() : null,
                    evidenceError: r.evidence_error,
                    status: r.status,
                  })}
                </span>
                <span className="text-sm text-zinc-500">Seen {formatWhen(new Date(r.first_seen_at).toISOString())}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
