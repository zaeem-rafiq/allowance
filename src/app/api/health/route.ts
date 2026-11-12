// Reports whether each part Allowance needs is configured: true or false only, never a value.
import { connection } from "next/server";
import { healthReport } from "@/lib/health";

export async function GET() {
  await connection();
  return Response.json(await healthReport(), { headers: { "Cache-Control": "no-store" } });
}
