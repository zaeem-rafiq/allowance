import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HiddenLine } from "@/components/try-it/HiddenLine";
import { getProduct } from "@/lib/catalog/catalog";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/money/cents";
import { DEFAULT_HIDDEN_LINE } from "@/lib/runs/forced-cart";
import { POISONED_PRODUCT_ID } from "@/lib/runs/run";
import { VISITOR_COOKIE, hashVisitorKey } from "@/lib/visitor/ledger";

export const metadata: Metadata = { title: "Demo store · Allowance" };

export default function StorePage({ params, searchParams }: PageProps<"/store/[productId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
        ← Back to the try-it page
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Loading the product page…</p>}>
        <ProductPage params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The visitor's own hidden line for a run, or null. No visitor sees another visitor's text. */
async function visitorLine(runId: string | undefined): Promise<string | null> {
  if (!runId || !/^[0-9a-f-]{36}$/.test(runId)) return null;
  await connection();
  const cookie = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const db = await getDb();
    const rows = await db.query<{ hidden_line: string | null }>(
      `SELECT r.hidden_line FROM runs r JOIN ledgers l ON l.id = r.ledger_id
       WHERE r.id = $1 AND l.visitor_key_hash = $2 AND r.kind = 'agent'`,
      [runId, hashVisitorKey(cookie)],
    );
    return rows[0]?.hidden_line ?? null;
  } catch {
    return null;
  }
}

async function ProductPage({
  params,
  searchParams,
}: {
  params: PageProps<"/store/[productId]">["params"];
  searchParams: PageProps<"/store/[productId]">["searchParams"];
}) {
  const { productId } = await params;
  const product = getProduct(productId);
  if (!product) notFound();
  const sp = await searchParams;
  const runId = typeof sp.run === "string" ? sp.run : undefined;
  const line = product.id === POISONED_PRODUCT_ID ? ((await visitorLine(runId)) ?? DEFAULT_HIDDEN_LINE) : null;

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Allowance demo store</p>
      <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
      <p className="text-2xl font-medium">{formatUsd(product.priceCents)}</p>
      <p className="text-zinc-700 dark:text-zinc-300">{product.description}</p>
      {line !== null && <HiddenLine text={line} />}
    </article>
  );
}
