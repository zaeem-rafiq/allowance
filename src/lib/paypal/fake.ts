// A fake PayPal for test mode (KTD5). It returns scripted results and counts calls.
// Its "approval page" is a test-only route that sends the browser straight back.
import type { ChargeResult, FinishSaveResult, PayPalPort, StartSaveResult } from "./port";

export type ScriptedCharge = "captured" | "refused" | "unknown";

export class FakePayPal implements PayPalPort {
  calls = { startSave: 0, finishSave: 0, charge: 0, lookupOrder: 0 };
  script: ScriptedCharge[] = [];
  private orders = new Map<string, ChargeResult>();
  private pendingReturn = new Map<string, string>();
  private seq = 0;

  reset(): void {
    this.calls = { startSave: 0, finishSave: 0, charge: 0, lookupOrder: 0 };
    this.script = [];
    this.orders.clear();
    this.pendingReturn.clear();
    this.seq = 0;
  }

  /** Where the fake approval page sends the browser back to, for a setup token. */
  returnUrlFor(setupTokenId: string): string | undefined {
    return this.pendingReturn.get(setupTokenId);
  }

  async startSave(opts: { returnUrl: string; cancelUrl: string; requestId: string }): Promise<StartSaveResult> {
    this.calls.startSave++;
    const setupTokenId = `FAKE-SETUP-${++this.seq}`;
    this.pendingReturn.set(setupTokenId, opts.returnUrl);
    const origin = new URL(opts.returnUrl).origin;
    return { setupTokenId, approveUrl: `${origin}/api/test/paypal-approve?token=${setupTokenId}` };
  }

  async finishSave(opts: { setupTokenId: string }): Promise<FinishSaveResult> {
    this.calls.finishSave++;
    if (!this.pendingReturn.has(opts.setupTokenId)) throw new Error("Unknown setup token");
    return { paymentTokenId: `FAKE-VAULT-${opts.setupTokenId}`, customerId: "FAKE-CUSTOMER" };
  }

  async charge(opts: { vaultId: string; requestId: string; items: { unitCents: number; quantity: number }[] }): Promise<ChargeResult> {
    this.calls.charge++;
    const existing = this.orders.get(opts.requestId);
    if (existing && existing.status === "captured") return existing;
    const next = this.script.shift() ?? "captured";
    const amountCents = opts.items.reduce((s, i) => s + i.unitCents * i.quantity, 0);
    if (next === "refused") return { status: "refused", reason: "INSTRUMENT_DECLINED" };
    if (next === "unknown") {
      // The charge may or may not have happened; the next repeat with this ID decides.
      return { status: "unknown", reason: "PayPal timed out" };
    }
    const n = ++this.seq;
    const result: ChargeResult = {
      status: "captured",
      orderId: `FAKE-ORDER-${n}`,
      captureId: `FAKE-CAPTURE-${n}`,
      amountCents,
      at: new Date().toISOString(),
    };
    this.orders.set(opts.requestId, result);
    return result;
  }

  async lookupOrder(orderId: string): Promise<ChargeResult> {
    this.calls.lookupOrder++;
    for (const r of this.orders.values()) if (r.status === "captured" && r.orderId === orderId) return r;
    return { status: "refused", reason: "RESOURCE_NOT_FOUND" };
  }
}
