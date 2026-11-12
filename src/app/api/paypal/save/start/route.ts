// Owner only: start saving PayPal and send the owner to PayPal's sandbox approval page.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { forbidden, isSameOrigin, siteOrigin } from "@/lib/http";
import { currentOwner } from "@/lib/owner/guard";
import { startSave } from "@/lib/owner/paypal-save";
import { getPayPal, now } from "@/lib/ports";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  const session = await currentOwner();
  if (!session) return forbidden("Owner only.");
  const origin = siteOrigin(request);
  try {
    const approveUrl = await startSave(await getDb(), getPayPal(), session, origin, now());
    return NextResponse.redirect(approveUrl, 303);
  } catch {
    return NextResponse.redirect(`${origin}/owner?paypal=failed`, 303);
  }
}
