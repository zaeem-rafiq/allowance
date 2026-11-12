// The visitor's own spend log as JSON. It reads the visitor cookie and never creates a ledger.
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getSpendLog } from "@/lib/log/spend-log";
import { VISITOR_COOKIE } from "@/lib/visitor/ledger";
import { readCookie } from "@/lib/visitor/request";

export async function GET(request: Request) {
  await connection();
  let cookie: string | undefined;
  try {
    cookie = readCookie(request, VISITOR_COOKIE);
  } catch {
    cookie = undefined; // A cookie that cannot be decoded owns no ledger.
  }
  try {
    const rows = await getSpendLog(await getDb(), cookie);
    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "The log could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
