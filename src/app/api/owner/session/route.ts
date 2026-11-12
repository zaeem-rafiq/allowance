// Owner sign-in (R21, KTD11). A plain form posts the secret here.
import { NextResponse } from "next/server";
import { forbidden, isSameOrigin, siteOrigin, shouldUseSecureCookies } from "@/lib/http";
import { now } from "@/lib/ports";
import { OWNER_COOKIE, issueSessionCookie, ownerConfigured, secretMatches } from "@/lib/owner/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  const origin = siteOrigin(request);
  if (!ownerConfigured()) return NextResponse.redirect(`${origin}/owner?error=not-configured`, 303);
  const form = await request.formData().catch(() => null);
  const secret = form?.get("secret");
  if (!secretMatches(secret)) return NextResponse.redirect(`${origin}/owner?error=wrong`, 303);
  const { value } = issueSessionCookie(now().getTime());
  const res = NextResponse.redirect(`${origin}/owner`, 303);
  res.cookies.set(OWNER_COOKIE, value, {
    httpOnly: true,
    secure: shouldUseSecureCookies(request),
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
