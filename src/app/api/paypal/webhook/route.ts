// PayPal's dispute webhooks. A message counts only when PayPal confirms it with its own
// verify-webhook-signature call, using PAYPAL_WEBHOOK_ID and the raw body.
import { getDb } from "@/lib/db";
import { receiveWebhook } from "@/lib/disputes/handle";
import { getDisputesPort } from "@/lib/disputes/port";
import { now } from "@/lib/ports";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  const result = await receiveWebhook({
    getDb,
    getPort: getDisputesPort,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
    headers,
    rawBody,
    clock: now,
  });
  return Response.json(result.body, { status: result.status });
}
