// The recorded run, shown at a cap or when the AI is busy.
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { featuredRun } from "@/lib/runs/recorded";

export async function GET() {
  await connection();
  try {
    const run = await featuredRun(await getDb());
    if (!run) return Response.json({ run: null }, { status: 404 });
    return Response.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ run: null }, { status: 503 });
  }
}
