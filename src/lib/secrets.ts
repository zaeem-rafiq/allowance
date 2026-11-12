// Server secrets. Test mode uses fixed test values. Local development without the hosted
// names uses development values from the git-ignored file .data/dev-secrets.json, which the
// agent generates; .env.local is never read by hand. Production reads only the environment.
import { readFileSync } from "node:fs";
import { TEST_SECRETS, isTestMode } from "@/lib/mode";

type SecretName = "OWNER_SECRET" | "MANDATE_SIGNING_KEY";

function devSecrets(): Partial<Record<SecretName, string>> {
  if (process.env.NODE_ENV === "production") return {};
  try {
    return JSON.parse(readFileSync(".data/dev-secrets.json", "utf8"));
  } catch {
    return {};
  }
}

/** Returns the secret, or null when it is not configured (fewer than 16 characters counts as unset). */
export function getSecret(name: SecretName): string | null {
  if (isTestMode()) return TEST_SECRETS[name];
  const value = process.env[name]?.trim() || devSecrets()[name]?.trim() || "";
  return value.length >= 16 ? value : null;
}
