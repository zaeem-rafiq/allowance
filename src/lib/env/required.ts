// The settings Allowance reads from its environment. The keys check prints each name as
// "set" or "missing" and never prints a value.

/** Needed on this Mac and on Render for real PayPal and AI calls. */
export const REQUIRED_NAMES = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
] as const;

/**
 * Needed on Render only. This Mac cannot reach Render's database (its access list blocks
 * outside connections), so local development uses an on-disk PGlite database and its own
 * development secrets. `/api/health` on the preview checks these.
 */
export const HOSTED_NAMES = ["DATABASE_URL", "OWNER_SECRET", "MANDATE_SIGNING_KEY"] as const;

/** Nice to have: dispute webhooks and AI tracing. */
export const OPTIONAL_NAMES = ["PAYPAL_WEBHOOK_ID", "ARIZE_API_KEY", "ARIZE_SPACE_ID"] as const;

type Env = Record<string, string | undefined>;

export function isSet(env: Env, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export interface EnvReport {
  ok: boolean;
  lines: string[];
}

/** Lists every name as set or missing. `ok` is false when a required name is missing. */
export function envReport(env: Env, opts: { hosted?: boolean } = {}): EnvReport {
  const lines: string[] = [];
  let ok = true;
  lines.push("Required:");
  for (const name of REQUIRED_NAMES) {
    const set = isSet(env, name);
    if (!set) ok = false;
    lines.push(`  ${name}: ${set ? "set" : "missing"}`);
  }
  lines.push(opts.hosted ? "Hosted (required here):" : "Hosted (Render only, checked by /api/health):");
  for (const name of HOSTED_NAMES) {
    const set = isSet(env, name);
    if (!set && opts.hosted) ok = false;
    lines.push(`  ${name}: ${set ? "set" : "missing"}`);
  }
  lines.push("Optional:");
  for (const name of OPTIONAL_NAMES) {
    lines.push(`  ${name}: ${isSet(env, name) ? "set" : "missing"}`);
  }
  return { ok, lines };
}
