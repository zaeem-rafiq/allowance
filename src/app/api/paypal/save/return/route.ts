// PayPal sends the owner back here after the sandbox approval page. Only the setup token this
// owner session started is accepted.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { siteOrigin } from "@/lib/http";
import { currentOwner } from "@/lib/owner/guard";
import { finishSave } from "@/lib/owner/paypal-save";
import { getPayPal, now } from "@/lib/ports";

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const session = await currentOwner();
  if (!session) return NextResponse.redirect(`${origin}/owner?paypal=refused`, 303);
  const params = new URL(request.url).searchParams;
  const token = params.get("approval_token_id") ?? params.get("approval_session_id") ?? params.get("token");
  const outcome = await finishSave(await getDb(), getPayPal(), session, token, now());
  return NextResponse.redirect(`${origin}/owner?paypal=${outcome}`, 303);
}
