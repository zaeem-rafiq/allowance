import type { FullConfig } from "@playwright/test";

// The test server compiles each route on first use, and a first compile can reload an open page.
// Loading every route once before the tests keeps the first test from meeting that reload.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? "http://localhost:3101";
  const origin = { origin: base, "content-type": "application/json" };
  const hits: [string, RequestInit][] = [
    ["/", {}],
    ["/owner", {}],
    ["/store/paper-towels", {}],
    ["/receipts/AAAAAAAAAAAAAAAAAAAAAA", {}],
    ["/api/health", {}],
    ["/api/runs/featured", {}],
    ["/api/test/control", { method: "POST", headers: origin, body: JSON.stringify({ reset: true, savedPayPal: true }) }],
    ["/api/runs", { method: "POST", headers: origin, body: JSON.stringify({ kind: "skip", hiddenLine: "warm up" }) }],
    ["/api/owner/session", { method: "POST", headers: { origin: base } }],
    ["/api/paypal/save/start", { method: "POST", headers: { origin: base } }],
    ["/api/paypal/save/return", { redirect: "manual" }],
    ["/api/owner/feature-run", { method: "POST", headers: { origin: base }, redirect: "manual" }],
    ["/api/test/paypal-approve?token=x", {}],
  ];
  for (const [path, init] of hits) {
    const res = await fetch(base + path, { redirect: "manual", ...init });
    await res.arrayBuffer().catch(() => undefined);
  }
}
