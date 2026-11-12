// Test mode only: the fake PayPal's approval page. It sends the browser straight back.
import { NextResponse } from "next/server";
import { isTestMode } from "@/lib/mode";
import { getFakePayPal } from "@/lib/ports";

export async function GET(request: Request) {
  if (!isTestMode()) return new Response("Not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const back = getFakePayPal().returnUrlFor(token);
  if (!back) return new Response("Unknown setup token", { status: 400 });
  return NextResponse.redirect(`${back}?approval_token_id=${encodeURIComponent(token)}`, 303);
}
