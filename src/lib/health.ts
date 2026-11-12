// Whether each part Allowance needs is configured: true or false only, never a value.
import { getDb } from "@/lib/db";
import { isSet } from "@/lib/env/required";
import { getSecret } from "@/lib/secrets";
import { SAVED_PAYPAL_KEY, getSetting } from "@/lib/settings";

export async function healthReport(): Promise<Record<string, boolean>> {
  let database = false;
  let paypalSaved = false;
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    database = true;
    paypalSaved = (await getSetting(db, SAVED_PAYPAL_KEY)) !== null;
  } catch {
    database = false;
  }
  return {
    database,
    paypalKeys: isSet(process.env, "PAYPAL_CLIENT_ID") && isSet(process.env, "PAYPAL_CLIENT_SECRET"),
    paypalSaved,
    aiKey: isSet(process.env, "ANTHROPIC_API_KEY"),
    signingKey: getSecret("MANDATE_SIGNING_KEY") !== null,
    ownerSecret: getSecret("OWNER_SECRET") !== null,
  };
}
