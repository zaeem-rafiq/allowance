// Request helpers shared by the route handlers.

/** The site's own origin as the browser sees it, behind Render's proxy. */
export function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/** State-changing requests must carry the site's own Origin (KTD11). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === siteOrigin(request);
}

export function forbidden(message = "Not allowed."): Response {
  return Response.json({ error: message }, { status: 403 });
}

export function shouldUseSecureCookies(request: Request): boolean {
  return siteOrigin(request).startsWith("https://") || process.env.NODE_ENV === "production";
}
