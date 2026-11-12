// One switch binds every fake: ALLOWANCE_TEST_MODE=1 (KTD5). The app refuses it in a
// production build, so a deployed server can never run on the fakes.

export const TEST_MODE_VAR = "ALLOWANCE_TEST_MODE";

export function isTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env[TEST_MODE_VAR] === "1";
}

/** Throws when test mode is on in a production build. Called before any port is bound. */
export function assertModeAllowed(env: Record<string, string | undefined> = process.env): void {
  if (isTestMode(env) && env.NODE_ENV === "production") {
    throw new Error(
      `${TEST_MODE_VAR}=1 is not allowed in a production build. Remove ${TEST_MODE_VAR} from the environment.`,
    );
  }
}

/** Fixed stand-in values for test mode only. They are not real keys and unlock nothing real. */
export const TEST_SECRETS = {
  OWNER_SECRET: "owner-test-".repeat(3),
  MANDATE_SIGNING_KEY: "mandate-test-".repeat(3),
} as const;
