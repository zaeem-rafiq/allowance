import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { SpendLog } from "@/components/spend-log";
import { getDb } from "@/lib/db";
import { settleForVisitor } from "@/lib/checkout/settle-on-read";
import { type LogRow, getSpendLog } from "@/lib/log/spend-log";
import { VISITOR_COOKIE } from "@/lib/visitor/ledger";

export const metadata: Metadata = { title: "Spend log · Allowance" };

export default function SpendLogPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Spend log</h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Every checkout your AI tried, allowed or blocked, with the rule that decided it.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading the log…</p>}>
        <LogTable />
      </Suspense>
    </main>
  );
}

/** This visitor's own attempts. A visitor with no cookie, or an unknown one, has no ledger and sees none. */
async function LogTable() {
  await connection();
  const cookie = (await cookies()).get(VISITOR_COOKIE)?.value;
  let rows: LogRow[];
  try {
    const db = await getDb();
    await settleForVisitor(db, cookie);
    rows = await getSpendLog(db, cookie);
  } catch {
    return <p className="text-zinc-600 dark:text-zinc-400">The log could not be loaded. Try again in a moment.</p>;
  }
  if (rows.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">No attempts yet.</p>;
  return <SpendLog rows={rows} />;
}
