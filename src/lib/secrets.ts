// Server secrets. Test mode uses fixed test values. Local development without the hosted
// names uses development values from the git-ignored file .data/dev-secrets.json, which the
// agent generates; .env.local is never read by hand. Production reads only the environment.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TEST_SECRETS, isTestMode } from "@/lib/mode";

type SecretName = "OWNER_SECRET" | "MANDATE_SIGNING_KEY";

const DEV_FILE = ".data/dev-secrets.json";

/** Development only: reads, or creates once, random development secrets in a git-ignored file. */
function devSecrets(): Partial<Record<SecretName, string>> {
  if (process.env.NODE_ENV === "production") return {};
  try {
    return JSON.parse(readFileSync(DEV_FILE, "utf8"));
  } catch {
    try {
      const fresh = {
        OWNER_SECRET: randomBytes(24).toString("base64url"),
        MANDATE_SIGNING_KEY: randomBytes(32).toString("base64url"),
      };
      mkdirSync(".data", { recursive: true });
      writeFileSync(DEV_FILE, JSON.stringify(fresh), { mode: 0o600, flag: "wx" });
      return fresh;
    } catch {
      return {};
    }
  }
}

/** Returns the secret, or null when it is not configured (fewer than 16 characters counts as unset). */
export function getSecret(name: SecretName): string | null {
  if (isTestMode()) return TEST_SECRETS[name];
  const value = process.env[name]?.trim() || devSecrets()[name]?.trim() || "";
  return value.length >= 16 ? value : null;
}
