import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Verdict } from "@/lib/checker/check-cart";
import { findAttemptByReceipt } from "@/lib/checkout/checkout";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/money/cents";

export const metadata: Metadata = { title: "Receipt · Allowance" };

export default function ReceiptPage({ params }: PageProps<"/receipts/[receiptId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Loading the receipt…</p>}>
        <Receipt params={params} />
      </Suspense>
    </main>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

async function Receipt({ params }: { params: PageProps<"/receipts/[receiptId]">["params"] }) {
  await connection();
  const { receiptId } = await params;
  const db = await getDb();
  const attempt = await findAttemptByReceipt(db, receiptId);
  if (!attempt || attempt.state !== "captured" || !attempt.paypal) notFound();
  const verdict = attempt.verdict as Extract<Verdict, { decision: "allow" }>;

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance receipt · PayPal sandbox</p>
        <h1 className="text-3xl font-semibold tracking-tight">{formatUsd(attempt.captured_cents)} charged</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Allowed by your rule: {attempt.rule}.</p>
      </header>
      <table className="w-full text-sm">
        <tbody>
          {verdict.lines.map((l) => (
            <tr key={l.productId} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">
                {l.quantity} × {l.name}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatUsd(l.lineTotalCents)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 font-medium">Total</td>
            <td className="py-1.5 text-right font-medium tabular-nums">{formatUsd(attempt.total_cents)}</td>
          </tr>
        </tbody>
      </table>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-zinc-500">PayPal order ID</dt>
        <dd className="break-all font-mono">{attempt.paypal.orderId}</dd>
        <dt className="text-zinc-500">PayPal capture ID</dt>
        <dd className="break-all font-mono">{attempt.paypal.captureId}</dd>
        <dt className="text-zinc-500">Charged at</dt>
        <dd>{fmtTime(attempt.paypal.at)}</dd>
        <dt className="text-zinc-500">Mandate</dt>
        <dd>
          Version {attempt.mandate_version}, hash <span className="break-all font-mono">{attempt.mandate_hash.slice(0, 16)}…</span>
        </dd>
      </dl>
      <p className="text-sm text-zinc-500">
        This is Allowance&apos;s stored copy, confirmed by PayPal on {fmtTime(attempt.settled_at ?? attempt.paypal.at)}.
      </p>
    </article>
  );
}
