// Owner only: ask PayPal for its recent disputes now, match them to Allowance's charges, send
// evidence where PayPal asks for it, and go back to the disputes list.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncDisputes } from "@/lib/disputes/handle";
import { getDisputesPort } from "@/lib/disputes/port";
import { forbidden, isSameOrigin, siteOrigin } from "@/lib/http";
import { currentOwner } from "@/lib/owner/guard";
import { now } from "@/lib/ports";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!(await currentOwner())) return forbidden("Owner only.");
  const origin = siteOrigin(request);
  try {
    const result = await syncDisputes(await getDb(), getDisputesPort(), now);
    return NextResponse.redirect(`${origin}/disputes?check=done&seen=${result.listed}&sent=${result.evidenceSent}`, 303);
  } catch {
    return NextResponse.redirect(`${origin}/disputes?check=failed`, 303);
  }
}
