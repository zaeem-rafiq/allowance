// U4's payment-path test, in two steps around the buyer's approval on PayPal's sandbox page.
//   npx tsx live/paypal-path.ts start    prints the approval link
//   (approve it as the sandbox buyer)
//   npx tsx live/paypal-path.ts finish   saves the account, then charges it twice with nobody
//                                       logged in, and repeats one request ID
// It prints order IDs and statuses only. The saved token reference goes to the git-ignored
// .data folder so local development can charge the same sandbox account.
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PayPalSandboxClient } from "../src/lib/paypal/client";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
const STATE = ".data/paypal-path.json";
mkdirSync(".data", { recursive: true });

const client = new PayPalSandboxClient(process.env.PAYPAL_CLIENT_ID ?? "", process.env.PAYPAL_CLIENT_SECRET ?? "");
const step = process.argv[2];

async function main() {
  if (step === "start") {
    const res = await client.startSave({
      returnUrl: "https://allowance-colm.onrender.com/owner/paypal?saved=1",
      cancelUrl: "https://allowance-colm.onrender.com/owner/paypal?cancelled=1",
      requestId: randomUUID(),
    });
    writeFileSync(STATE, JSON.stringify({ setupTokenId: res.setupTokenId, startedAt: new Date().toISOString() }));
    console.log("Setup token created. Approve it as the sandbox buyer at:");
    console.log(res.approveUrl);
    return;
  }
  if (step === "finish") {
    const state = JSON.parse(readFileSync(STATE, "utf8")) as { setupTokenId: string; paymentTokenId?: string };
    const saved = state.paymentTokenId
      ? { paymentTokenId: state.paymentTokenId }
      : await client.finishSave({ setupTokenId: state.setupTokenId, requestId: randomUUID() });
    writeFileSync(STATE, JSON.stringify({ ...state, paymentTokenId: saved.paymentTokenId, savedAt: new Date().toISOString() }));
    console.log("Saved PayPal: yes");
    const items = [{ name: "Dish soap", quantity: 1, unitCents: 400 }];
    const id1 = randomUUID();
    const first = await client.charge({ vaultId: saved.paymentTokenId, requestId: id1, items, description: "Allowance path test 1" });
    console.log("Charge 1:", first.status, "orderId" in first ? first.orderId : "", "reason" in first ? first.reason : "");
    const second = await client.charge({
      vaultId: saved.paymentTokenId,
      requestId: randomUUID(),
      items: [{ name: "Sponges, 6 pack", quantity: 1, unitCents: 400 }],
      description: "Allowance path test 2",
    });
    console.log("Charge 2:", second.status, "orderId" in second ? second.orderId : "", "reason" in second ? second.reason : "");
    const repeat = await client.charge({ vaultId: saved.paymentTokenId, requestId: id1, items, description: "Allowance path test 1" });
    console.log("Repeat of charge 1:", repeat.status, "orderId" in repeat ? repeat.orderId : "");
    const sameOrder = first.status === "captured" && repeat.status === "captured" && first.orderId === repeat.orderId;
    console.log("Repeat returned the same order:", sameOrder ? "yes" : "no");
    const pass = first.status === "captured" && second.status === "captured" && sameOrder;
    console.log(pass ? "PATH TEST PASSED: saved PayPal charges with nobody logged in." : "PATH TEST FAILED");
    process.exit(pass ? 0 : 1);
  }
  console.log("Usage: npx tsx live/paypal-path.ts start|finish");
  process.exit(2);
}

main().catch((err) => {
  console.error("Path test error:", err instanceof Error ? err.message : "unknown");
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body: Record<string, unknown> | null }).body;
    console.error("PayPal said:", JSON.stringify({ name: body?.name, details: body?.details }));
  }
  process.exit(1);
});
