import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RuleWriter, type SignedView } from "@/components/rule-writer";
import { getDb } from "@/lib/db";
import { intentMandateSchema } from "@/lib/mandate/schema";
import { currentOwner } from "@/lib/owner/guard";
import { now } from "@/lib/ports";
import { getSecret } from "@/lib/secrets";
import {
  DEMO_LEDGER_ID,
  type MandateVersionRow,
  VISITOR_COOKIE,
  currentMandate,
  ensureDemoLedger,
  hashVisitorKey,
} from "@/lib/visitor/ledger";

export const metadata: Metadata = { title: "Write a rule · Allowance" };

export default function RulePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Write the rule</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Type a spending rule the way you would say it. Allowance shows how the store will read it, line by line, before you
          sign. A rule you write changes only your own tries on the home page.{" "}
          <Link href="/mandate" className="underline underline-offset-4">
            See the demo parent&apos;s rule
          </Link>
          .
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <RuleLoader />
      </Suspense>
    </main>
  );
}

function toView(row: MandateVersionRow): SignedView {
  return {
    version: row.version,
    hash: row.hash,
    signature: row.signature,
    publicKey: row.public_key,
    mandate: intentMandateSchema.parse(row.mandate),
  };
}

async function loadCurrent(): Promise<{ owner: boolean; mine: SignedView; demo: SignedView | null } | null> {
  try {
    const secret = getSecret("MANDATE_SIGNING_KEY");
    if (!secret) throw new Error("MANDATE_SIGNING_KEY is not configured");
    const db = await getDb();
    const owner = (await currentOwner()) !== null;
    const demoRow = await db.transaction(async (tx) => {
      await ensureDemoLedger(tx, secret, now());
      return currentMandate(tx, DEMO_LEDGER_ID);
    });
    if (!demoRow) throw new Error("The demo mandate is missing");

    // A page cannot set the visitor cookie, so it only looks the ledger up. A visitor with no ledger
    // yet starts from a copy of the demo parent's rule, as version 1.
    const cookie = (await cookies()).get(VISITOR_COOKIE)?.value;
    let mineRow: MandateVersionRow | null = null;
    if (cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie)) {
      const ledger = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE visitor_key_hash = $1", [hashVisitorKey(cookie)]);
      if (ledger[0]) mineRow = await currentMandate(db, ledger[0].id);
    }
    return { owner, mine: toView(mineRow ?? { ...demoRow, version: 1 }), demo: owner ? toView(demoRow) : null };
  } catch {
    return null;
  }
}

async function RuleLoader() {
  await connection();
  const loaded = await loadCurrent();
  if (!loaded) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        The rule writer could not load. Try again in a moment.
      </p>
    );
  }
  return <RuleWriter isOwner={loaded.owner} current={{ mine: loaded.mine, demo: loaded.demo }} />;
}
