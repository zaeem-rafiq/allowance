// Live PayPal sandbox suite (U4): real charges on the saved sandbox account, with nobody logged in.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { beforeAll, describe, expect, it } from "vitest";
import { PayPalSandboxClient } from "@/lib/paypal/client";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

let client: PayPalSandboxClient;
let vaultId: string;

beforeAll(() => {
  const state = JSON.parse(readFileSync(".data/paypal-path.json", "utf8")) as { paymentTokenId?: string };
  if (!state.paymentTokenId) throw new Error("Run `npx tsx live/paypal-path.ts start|finish` first.");
  vaultId = state.paymentTokenId;
  client = new PayPalSandboxClient(process.env.PAYPAL_CLIENT_ID ?? "", process.env.PAYPAL_CLIENT_SECRET ?? "");
});

describe("PayPal sandbox, live", () => {
  it("charges the saved account with no buyer present", async () => {
    const result = await client.charge({
      vaultId,
      requestId: randomUUID(),
      items: [{ name: "Dish soap", quantity: 1, unitCents: 400 }],
      description: "Allowance live suite",
    });
    expect(result.status).toBe("captured");
    if (result.status === "captured") {
      expect(result.amountCents).toBe(400);
      expect(result.captureId).toBeTruthy();
      const looked = await client.lookupOrder(result.orderId);
      expect(looked.status).toBe("captured");
    }
  });

  it("returns the same order for a repeat with the same request ID", async () => {
    const requestId = randomUUID();
    const items = [{ name: "Sponges, 6 pack", quantity: 1, unitCents: 400 }];
    const first = await client.charge({ vaultId, requestId, items, description: "Allowance live suite repeat" });
    const second = await client.charge({ vaultId, requestId, items, description: "Allowance live suite repeat" });
    expect(first.status).toBe("captured");
    expect(second.status).toBe("captured");
    if (first.status === "captured" && second.status === "captured") expect(second.orderId).toBe(first.orderId);
  });

  it("refuses an unknown saved account with a plain reason", async () => {
    const result = await client.charge({
      vaultId: "NOT-A-REAL-TOKEN",
      requestId: randomUUID(),
      items: [{ name: "Dish soap", quantity: 1, unitCents: 400 }],
      description: "Allowance live suite refusal",
    });
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.reason).toMatch(/^[A-Z0-9_]+$/);
  });
});
