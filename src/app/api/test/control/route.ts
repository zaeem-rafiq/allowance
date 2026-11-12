// Test mode only: steer the fakes, the clock and the database between browser tests (KTD5).
import { connection } from "next/server";
import { getDb, resetDbForTests } from "@/lib/db";
import { isTestMode } from "@/lib/mode";
import type { ScriptedCharge } from "@/lib/paypal/fake";
import { getFakePayPal, setTestClock } from "@/lib/ports";
import { SAVED_PAYPAL_KEY, setSetting } from "@/lib/settings";
import { resetTestHooks, setTestHooks } from "@/lib/test-hooks";

export async function GET() {
  await connection();
  if (!isTestMode()) return new Response("Not found", { status: 404 });
  return Response.json({ paypalCalls: getFakePayPal().calls });
}

export async function POST(request: Request) {
  if (!isTestMode()) return new Response("Not found", { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    reset?: boolean;
    clock?: string | null;
    paypal?: ScriptedCharge[];
    hooks?: Record<string, unknown>;
    savedPayPal?: boolean;
  };
  if (body.reset) {
    await resetDbForTests();
    getFakePayPal().reset();
    setTestClock(null);
    resetTestHooks();
  }
  if (body.clock !== undefined) setTestClock(body.clock ? new Date(body.clock) : null);
  if (body.paypal) getFakePayPal().script = [...body.paypal];
  if (body.hooks) setTestHooks(body.hooks);
  if (body.savedPayPal) {
    await setSetting(await getDb(), SAVED_PAYPAL_KEY, {
      paymentTokenId: "FAKE-VAULT-SEEDED",
      customerId: null,
      savedAt: new Date().toISOString(),
    });
  }
  return Response.json({ ok: true, paypalCalls: getFakePayPal().calls });
}
