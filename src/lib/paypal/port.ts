// The PayPal port (U4): four actions. The sandbox adapter and the fake both implement it.

export interface ChargeItem {
  name: string;
  quantity: number;
  unitCents: number;
}

export type ChargeResult =
  | { status: "captured"; orderId: string; captureId: string; amountCents: number; at: string }
  | { status: "refused"; reason: string; orderId?: string }
  | { status: "unknown"; reason: string };

export interface StartSaveResult {
  setupTokenId: string;
  approveUrl: string;
}

export interface FinishSaveResult {
  paymentTokenId: string;
  customerId: string | null;
}

export interface PayPalPort {
  /** Creates a setup token and returns PayPal's hosted approval link. */
  startSave(opts: { returnUrl: string; cancelUrl: string; requestId: string }): Promise<StartSaveResult>;
  /** Exchanges an approved setup token for a payment token (the saved PayPal account). */
  finishSave(opts: { setupTokenId: string; requestId: string }): Promise<FinishSaveResult>;
  /**
   * Charges the saved account with nobody logged in. The request ID makes it safe to repeat:
   * the same ID returns the same order instead of a second charge.
   */
  charge(opts: {
    vaultId: string;
    requestId: string;
    items: ChargeItem[];
    description: string;
  }): Promise<ChargeResult>;
  /** Reads an order's current state. */
  lookupOrder(orderId: string): Promise<ChargeResult>;
}
