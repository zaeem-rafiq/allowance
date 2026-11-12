import type { Metadata } from "next";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { currentOwner } from "@/lib/owner/guard";
import { getSavedPayPal } from "@/lib/owner/paypal-save";
import { ownerConfigured } from "@/lib/owner/session";

export const metadata: Metadata = { title: "Owner · Allowance" };

const NOTICES: Record<string, { text: string; tone: "good" | "bad" }> = {
  "paypal=saved": { text: "PayPal saved. The store can now charge it within your rule.", tone: "good" },
  "paypal=cancelled": { text: "PayPal was not saved. Your earlier saved account, if any, is unchanged.", tone: "bad" },
  "paypal=refused": {
    text: "That PayPal approval was not started from this sign-in, so it was not used.",
    tone: "bad",
  },
  "paypal=failed": { text: "PayPal did not accept the saved account. Nothing changed. Try again.", tone: "bad" },
  "recorded=set": { text: "Your latest run in this browser is now the recorded run.", tone: "good" },
  "recorded=none": { text: "No finished run found in this browser. Run Try it on the home page first.", tone: "bad" },
  "error=wrong": { text: "That secret is not right.", tone: "bad" },
  "error=not-configured": { text: "Owner sign-in is not configured on this server.", tone: "bad" },
};

export default function OwnerPage({ searchParams }: PageProps<"/owner">) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Owner</h1>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <OwnerPanel searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function OwnerPanel({ searchParams }: { searchParams: PageProps<"/owner">["searchParams"] }) {
  const params = await searchParams;
  const key = ["paypal", "error", "recorded"]
    .map((k) => (typeof params[k] === "string" ? `${k}=${params[k]}` : null))
    .find((k) => k && NOTICES[k]);
  const notice = key ? NOTICES[key] : null;

  if (!ownerConfigured()) {
    return (
      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="font-medium">Owner sign-in is not configured on this server.</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">The owner pages stay closed until it is.</p>
      </section>
    );
  }

  const session = await currentOwner();
  if (!session) {
    return (
      <section className="flex flex-col gap-4">
        {notice && <Notice {...notice} />}
        <form method="post" action="/api/owner/session" className="flex flex-col gap-3">
          <label htmlFor="secret" className="font-medium">
            Owner secret
          </label>
          <input
            id="secret"
            name="secret"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="self-start rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Sign in
          </button>
        </form>
      </section>
    );
  }

  let saved = null;
  let dbError = false;
  try {
    saved = await getSavedPayPal(await getDb());
  } catch {
    dbError = true;
  }

  return (
    <section className="flex flex-col gap-4">
      {notice && <Notice {...notice} />}
      <p className="text-zinc-600 dark:text-zinc-400">Signed in as the owner.</p>
      <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">PayPal</h2>
        {dbError ? (
          <p className="mt-1 text-red-700 dark:text-red-400">The database could not be reached.</p>
        ) : saved ? (
          <p className="mt-1">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">PayPal saved</span>
            <span className="text-zinc-600 dark:text-zinc-400"> on {new Date(saved.savedAt).toUTCString()}</span>
          </p>
        ) : (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">PayPal is not saved yet.</p>
        )}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You approve once on PayPal&apos;s own sandbox page. After that the store charges this account with nobody
          logged in, and only when your rule allows the cart.
        </p>
        <form method="post" action="/api/paypal/save/start" className="mt-4">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            {saved ? "Replace saved PayPal" : "Save PayPal"}
          </button>
        </form>
      </div>
      <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Recorded run</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Visitors see the recorded run when they reach a usage cap or the AI is busy. It is a real run, shown with the
          date it happened.
        </p>
        <form method="post" action="/api/owner/feature-run" className="mt-4">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Use my latest run as the recorded run
          </button>
        </form>
      </div>
    </section>
  );
}

function Notice({ text, tone }: { text: string; tone: "good" | "bad" }) {
  return (
    <p
      role="status"
      className={
        tone === "good"
          ? "rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950 dark:text-red-200"
      }
    >
      {text}
    </p>
  );
}
