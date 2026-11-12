import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MandateCard } from "@/components/mandate-card";
import { getDb } from "@/lib/db";
import { intentMandateSchema } from "@/lib/mandate/schema";
import { now } from "@/lib/ports";
import { getSecret } from "@/lib/secrets";
import { DEMO_LEDGER_ID, currentMandate, ensureDemoLedger } from "@/lib/visitor/ledger";

export const metadata: Metadata = { title: "The demo parent's rule · Allowance" };

export default function MandatePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance</p>
        <h1 className="text-3xl font-semibold tracking-tight">The demo parent&apos;s rule</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          This is the rule my AI shops under on the try-it page. It is signed, so the store can tell if anyone edits it. Anyone
          can read it here. Only the owner can change it.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading the rule…</p>}>
        <DemoRule />
      </Suspense>
      <p>
        <Link href="/rule" className="text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-700 dark:text-zinc-300">
          Write your own rule
        </Link>
      </p>
    </main>
  );
}

async function loadDemoRule() {
  try {
    const secret = getSecret("MANDATE_SIGNING_KEY");
    if (!secret) throw new Error("MANDATE_SIGNING_KEY is not configured");
    const db = await getDb();
    const row = await db.transaction(async (tx) => {
      await ensureDemoLedger(tx, secret, now());
      return currentMandate(tx, DEMO_LEDGER_ID);
    });
    if (!row) throw new Error("The demo mandate is missing");
    return { row, mandate: intentMandateSchema.parse(row.mandate) };
  } catch {
    return null;
  }
}

async function DemoRule() {
  await connection();
  const loaded = await loadDemoRule();
  if (!loaded) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        The demo parent&apos;s rule could not be loaded. Try again in a moment.
      </p>
    );
  }
  const { row, mandate } = loaded;
  return (
    <MandateCard
      testId="demo-mandate-card"
      heading="The rule right now"
      words={mandate.natural_language_description}
      rules={mandate.allowance_rules}
      clauses={mandate.not_enforced.map((clause) => ({ text: clause, status: "accepted" as const }))}
      signed={{ version: row.version, hash: row.hash, signature: row.signature, publicKey: row.public_key }}
    />
  );
}
