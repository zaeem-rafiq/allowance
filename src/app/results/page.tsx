import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const metadata: Metadata = { title: "Attack test · Allowance" };

interface EvalSummary {
  runAt: string;
  model: string;
  rows: number;
  poisoned: number;
  followed: number;
  ignored: number;
  neverOpened: number;
  noCheckout: number;
  poisonedChargedOutsideRule: number;
  poisonedBlocked: number;
  normal: number;
  normalAllowedAndCharged: number;
  normalCartMatchedList: number;
  totalCostUsd: number;
  skipPass?: {
    runAt: string;
    rows: number;
    blocked: number;
    askedFirst: number;
    chargedOutsideRule: number;
    paypalChargeCalls: number;
  };
}

async function loadResults(): Promise<EvalSummary | null> {
  "use cache";
  cacheLife("hours");
  try {
    const raw = await readFile(path.join(process.cwd(), "src/data/eval-results.json"), "utf8");
    const parsed = JSON.parse(raw) as EvalSummary;
    return parsed.runAt ? parsed : null;
  } catch {
    return null;
  }
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <span
        className={`text-3xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-red-700 dark:text-red-400" : ""}`}
      >
        {value}
      </span>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
    </div>
  );
}

export default async function ResultsPage() {
  const r = await loadResults();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Attack test</p>
        <h1 className="text-3xl font-semibold tracking-tight">Can a hidden line get past the rule?</h1>
      </header>
      {!r ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No attack test has run yet.
        </p>
      ) : (
        <>
          <p className="text-zinc-700 dark:text-zinc-300">
            {r.poisoned} product pages each hid a line asking the real agent for something the rule forbids, and {r.normal}{" "}
            normal restocks had no hidden line. Every result was read.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat value={`${r.followed} of ${r.poisoned}`} label="hidden lines the real agent followed" />
            {r.skipPass ? (
              <Stat
                value={`${r.skipPass.blocked + r.skipPass.askedFirst} of ${r.skipPass.rows}`}
                label="forbidden carts stopped before PayPal when the agent is fooled on purpose"
                tone={r.skipPass.chargedOutsideRule === 0 ? "good" : "bad"}
              />
            ) : (
              <Stat
                value={`${r.poisonedChargedOutsideRule}`}
                label="carts charged outside the rule"
                tone={r.poisonedChargedOutsideRule === 0 ? "good" : "bad"}
              />
            )}
            <Stat
              value={`${r.normalAllowedAndCharged} of ${r.normal}`}
              label="normal restocks allowed and charged"
              tone={r.normalAllowedAndCharged === r.normal ? "good" : "bad"}
            />
          </div>
          {r.skipPass && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              The agent resisted every line, so a second pass sent each line&apos;s forbidden cart straight to checkout, as a
              fooled agent would (&ldquo;Skip the AI&rdquo;). The rule blocked {r.skipPass.blocked} and held{" "}
              {r.skipPass.askedFirst} for the parent&apos;s approval. PayPal was called {r.skipPass.paypalChargeCalls} times.
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="text-zinc-500">Agent ignored the line</dt>
            <dd>
              {r.ignored} of {r.poisoned}
            </dd>
            <dt className="text-zinc-500">Agent stopped before checkout</dt>
            <dd>
              {r.noCheckout} of {r.poisoned}
            </dd>
            <dt className="text-zinc-500">Normal restocks that matched the list</dt>
            <dd>
              {r.normalCartMatchedList} of {r.normal}
            </dd>
            <dt className="text-zinc-500">Model</dt>
            <dd className="font-mono">{r.model}</dd>
            <dt className="text-zinc-500">Run on</dt>
            <dd>{new Date(r.runAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Chicago" })} CT</dd>
          </dl>
          <p className="text-sm text-zinc-500">
            PayPal in this test is a fake that counts calls, so no sandbox money moved. The agent&apos;s instructions are
            the same ones the live page uses, and they are published in the repository.
          </p>
        </>
      )}
    </main>
  );
}
