// Owner only: mark the owner's latest agent run (in this browser) as the recorded run.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { forbidden, isSameOrigin, siteOrigin } from "@/lib/http";
import { currentOwner } from "@/lib/owner/guard";
import { featureLatestRun } from "@/lib/runs/recorded";
import { VISITOR_COOKIE, hashVisitorKey } from "@/lib/visitor/ledger";
import { readCookie } from "@/lib/visitor/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!(await currentOwner())) return forbidden("Owner only.");
  const origin = siteOrigin(request);
  const cookie = readCookie(request, VISITOR_COOKIE);
  if (!cookie) return NextResponse.redirect(`${origin}/owner?recorded=none`, 303);
  const db = await getDb();
  const ledger = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE visitor_key_hash = $1", [hashVisitorKey(cookie)]);
  const id = ledger[0] ? await featureLatestRun(db, ledger[0].id) : null;
  return NextResponse.redirect(`${origin}/owner?recorded=${id ? "set" : "none"}`, 303);
}
