// The visitor's own spend log as JSON. It reads the visitor cookie and never creates a ledger.
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { settleForVisitor } from "@/lib/checkout/settle-on-read";
import { getSpendLog } from "@/lib/log/spend-log";
import { VISITOR_COOKIE } from "@/lib/visitor/ledger";
import { readCookie } from "@/lib/visitor/request";

export async function GET(request: Request) {
  await connection();
  const cookie = readCookie(request, VISITOR_COOKIE);
  try {
    const db = await getDb();
    await settleForVisitor(db, cookie);
    const rows = await getSpendLog(db, cookie);
    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "The log could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
