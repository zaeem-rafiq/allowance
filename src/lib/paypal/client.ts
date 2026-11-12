// PayPal sandbox adapter (KTD2, R19). Direct REST calls. The sandbox address is fixed: there
// is no live-payments mode, and building the client for any other address fails.
import { centsToPayPal, payPalToCents } from "@/lib/money/cents";
import type { ChargeItem, ChargeResult, FinishSaveResult, PayPalPort, StartSaveResult } from "./port";

export const SANDBOX_API = "https://api-m.sandbox.paypal.com";
const TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

class PayPalHttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown> | null,
  ) {
    super(`PayPal returned ${status}`);
  }
}

class PayPalTimeoutError extends Error {}

/** A plain, secret-free reason from a PayPal error body. */
export function plainReason(status: number, body: Record<string, unknown> | null): string {
  const details = Array.isArray(body?.details) ? (body?.details as Record<string, unknown>[]) : [];
  const issue = typeof details[0]?.issue === "string" ? (details[0].issue as string) : null;
  const name = typeof body?.name === "string" ? (body.name as string) : null;
  const code = issue ?? name ?? `HTTP_${status}`;
  // Only PayPal's upper-case issue codes are passed on; free text could echo request data.
  return /^[A-Z0-9_]{2,64}$/.test(code) ? code : `HTTP_${status}`;
}

export class PayPalSandboxClient implements PayPalPort {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly opts: { baseUrl?: string; fetch?: FetchLike; now?: () => number } = {},
  ) {
    if ((opts.baseUrl ?? SANDBOX_API) !== SANDBOX_API) {
      throw new Error("Allowance talks only to PayPal's sandbox.");
    }
    if (!clientId || !clientSecret) throw new Error("PayPal sandbox keys are not set.");
  }

  private get fetchImpl(): FetchLike {
    return this.opts.fetch ?? fetch;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.fetchImpl(`${SANDBOX_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new PayPalHttpError(res.status, null);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  private async call(
    method: string,
    path: string,
    body: unknown,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await this.fetchImpl(`${SANDBOX_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new PayPalTimeoutError("PayPal timed out");
      }
      throw new PayPalTimeoutError("PayPal could not be reached");
    }
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = null;
    }
    if (!res.ok) throw new PayPalHttpError(res.status, json);
    return json ?? {};
  }

  async startSave(opts: { returnUrl: string; cancelUrl: string; requestId: string }): Promise<StartSaveResult> {
    const json = await this.call(
      "POST",
      "/v3/vault/setup-tokens",
      {
        payment_source: {
          paypal: {
            description: "Allowance: let your shopping AI pay the demo store within your rule",
            permit_multiple_payment_tokens: false,
            usage_pattern: "IMMEDIATE",
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            experience_context: {
              shipping_preference: "NO_SHIPPING",
              brand_name: "Allowance demo store",
              locale: "en-US",
              return_url: opts.returnUrl,
              cancel_url: opts.cancelUrl,
            },
          },
        },
      },
      opts.requestId,
    );
    const links = (json.links as { rel: string; href: string }[]) ?? [];
    const approve = links.find((l) => l.rel === "approve")?.href;
    if (typeof json.id !== "string" || !approve) throw new Error("PayPal did not return an approval link.");
    return { setupTokenId: json.id, approveUrl: approve };
  }

  async finishSave(opts: { setupTokenId: string; requestId: string }): Promise<FinishSaveResult> {
    const json = await this.call(
      "POST",
      "/v3/vault/payment-tokens",
      { payment_source: { token: { id: opts.setupTokenId, type: "SETUP_TOKEN" } } },
      opts.requestId,
    );
    if (typeof json.id !== "string") throw new Error("PayPal did not return a payment token.");
    const customer = json.customer as { id?: string } | undefined;
    return { paymentTokenId: json.id, customerId: customer?.id ?? null };
  }

  private parseOrder(json: Record<string, unknown>): ChargeResult {
    const orderId = typeof json.id === "string" ? json.id : undefined;
    const units = (json.purchase_units as Record<string, unknown>[] | undefined) ?? [];
    const captures =
      ((units[0]?.payments as Record<string, unknown> | undefined)?.captures as Record<string, unknown>[] | undefined) ??
      [];
    const cap = captures[0];
    if (json.status === "COMPLETED" && cap && cap.status === "COMPLETED" && orderId) {
      const amount = cap.amount as { value: string };
      return {
        status: "captured",
        orderId,
        captureId: String(cap.id),
        amountCents: payPalToCents(amount.value),
        at: String(cap.create_time ?? new Date(this.now()).toISOString()),
      };
    }
    // A pending capture may still complete, so it is not "nothing charged": keep the hold and
    // settle it later by repeating the same request ID.
    if (cap && cap.status === "PENDING") return { status: "unknown", reason: "CAPTURE_PENDING" };
    if (json.status === "PAYER_ACTION_REQUIRED") return { status: "refused", reason: "PAYER_ACTION_REQUIRED", orderId };
    if (cap && (cap.status === "DECLINED" || cap.status === "FAILED")) {
      return { status: "refused", reason: `CAPTURE_${cap.status}`, orderId };
    }
    return { status: "refused", reason: `ORDER_${String(json.status ?? "UNKNOWN")}`, orderId };
  }

  async charge(opts: { vaultId: string; requestId: string; items: ChargeItem[]; description: string; repeat?: boolean }): Promise<ChargeResult> {
    const totalCents = opts.items.reduce((sum, i) => sum + i.unitCents * i.quantity, 0);
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.requestId.slice(0, 256),
          description: opts.description.slice(0, 127),
          amount: {
            currency_code: "USD",
            value: centsToPayPal(totalCents),
            breakdown: { item_total: { currency_code: "USD", value: centsToPayPal(totalCents) } },
          },
          items: opts.items.map((i) => ({
            name: i.name.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: { currency_code: "USD", value: centsToPayPal(i.unitCents) },
          })),
        },
      ],
      payment_source: { paypal: { vault_id: opts.vaultId } },
    };
    let lastError = "PayPal timed out";
    // Whether an order request may have reached PayPal. Until one has, a failure means nothing
    // was charged; after one has, only PayPal's answer to the same request ID can say.
    // A repeat that settles an earlier attempt starts out as possibly sent.
    let orderMaybeSent = opts.repeat === true;
    // One retry with the same request ID: a timeout, a 5xx or a 429 may hide a charge that
    // already happened, and the repeat returns that same order instead of a second charge.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.accessToken();
      } catch {
        if (!orderMaybeSent) return { status: "refused", reason: "PAYPAL_UNREACHABLE" };
        lastError = "PAYPAL_UNREACHABLE";
        continue;
      }
      try {
        const json = await this.call("POST", "/v2/checkout/orders", body, opts.requestId);
        return this.parseOrder(json);
      } catch (err) {
        if (err instanceof PayPalHttpError) {
          const reason = err.status === 429 ? "RATE_LIMITED" : plainReason(err.status, err.body);
          // The same request ID still being processed: the first request may yet capture.
          // PayPal's Orders v2 errors list PREVIOUS_REQUEST_IN_PROGRESS (RESOURCE_CONFLICT) for this.
          if (err.status === 409 || /DUPLICATE|PREVIOUS_REQUEST_IN_PROGRESS|RESOURCE_CONFLICT/.test(reason)) {
            return { status: "unknown", reason };
          }
          if (err.status === 429) {
            lastError = reason;
            if (attempt === 0) continue;
            return orderMaybeSent ? { status: "unknown", reason } : { status: "refused", reason };
          }
          if (err.status >= 500) {
            orderMaybeSent = true;
            lastError = reason;
            continue;
          }
          // A definite refusal is final even on a repeat: PayPal answers a repeated request ID
          // with the first request's own result, and a request still running is a 409 (above).
          return { status: "refused", reason };
        }
        orderMaybeSent = true;
        lastError = err instanceof PayPalTimeoutError ? err.message : "PAYPAL_ERROR";
      }
    }
    return { status: "unknown", reason: lastError };
  }

  async lookupOrder(orderId: string): Promise<ChargeResult> {
    try {
      const json = await this.call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, undefined);
      return this.parseOrder(json);
    } catch (err) {
      if (err instanceof PayPalHttpError) return { status: "refused", reason: plainReason(err.status, err.body) };
      return { status: "unknown", reason: "PayPal timed out" };
    }
  }
}
