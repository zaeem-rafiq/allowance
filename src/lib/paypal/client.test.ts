// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PayPalSandboxClient, SANDBOX_API, plainReason } from "./client";
import type { ChargeItem } from "./port";

const CLIENT_ID = "client-id-123";
const CLIENT_SECRET = "super-secret-value-xyz";
const REQUEST_ID = "attempt-123";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Clock {
  now: number;
}

type Step = (clock: Clock) => Response | Promise<Response>;

const tokenResponse = (n: number, expiresIn = 3600) => Response.json({ access_token: `token-${n}`, expires_in: expiresIn });
const failure = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const completed = (amount = "22.00") =>
  Response.json({
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [
            { id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: amount }, create_time: "2026-11-12T03:00:00Z" },
          ],
        },
      },
    ],
  });
const pendingCapture = () =>
  Response.json({
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "PENDING", amount: { value: "22.00" } }] } }],
  });
const timeout = () => new DOMException("The operation timed out.", "TimeoutError");

const ITEMS: ChargeItem[] = [
  { name: "Paper towels, 6 rolls", quantity: 2, unitCents: 900 },
  { name: "Dish soap", quantity: 1, unitCents: 400 },
];

/** A client wired to a scripted fetch: no network. Token and order requests are recorded apart. */
function setup(script: { orders?: Step[]; token?: (n: number) => Response | Promise<Response> }) {
  const clock: Clock = { now: 1_000_000 };
  const calls = { token: [] as Call[], order: [] as Call[] };
  const orders = [...(script.orders ?? [])];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    if (call.url.endsWith("/v1/oauth2/token")) {
      calls.token.push(call);
      return script.token ? script.token(calls.token.length) : tokenResponse(calls.token.length);
    }
    calls.order.push(call);
    const step = orders.shift();
    if (!step) throw new Error("unexpected order request");
    return step(clock);
  }) as typeof fetch;
  const client = new PayPalSandboxClient(CLIENT_ID, CLIENT_SECRET, { fetch: fetchFn, now: () => clock.now });
  return { client, calls, clock };
}

const charge = (client: PayPalSandboxClient, items: ChargeItem[] = ITEMS) =>
  client.charge({ vaultId: "VAULT-1", requestId: REQUEST_ID, items, description: "Allowance demo store restock" });

describe("PayPal sandbox client: constructor", () => {
  it("refuses any address other than the sandbox", () => {
    expect(() => new PayPalSandboxClient(CLIENT_ID, CLIENT_SECRET, { baseUrl: "https://api-m.paypal.com" })).toThrow(/sandbox/i);
    expect(() => new PayPalSandboxClient(CLIENT_ID, CLIENT_SECRET, { baseUrl: "http://localhost:9999" })).toThrow(/sandbox/i);
    expect(() => new PayPalSandboxClient(CLIENT_ID, CLIENT_SECRET, { baseUrl: SANDBOX_API })).not.toThrow();
  });

  it("refuses empty keys", () => {
    expect(() => new PayPalSandboxClient("", CLIENT_SECRET)).toThrow(/keys/i);
    expect(() => new PayPalSandboxClient(CLIENT_ID, "")).toThrow(/keys/i);
  });
});

describe("PayPal sandbox client: access token", () => {
  it("is fetched once, reused until a minute before it expires, and then fetched again", async () => {
    const { client, calls, clock } = setup({});
    const base = clock.now;

    expect(await client.accessToken()).toBe("token-1");
    expect(await client.accessToken()).toBe("token-1");
    expect(calls.token).toHaveLength(1);
    expect(calls.token[0].headers.Authorization).toBe("Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"));
    expect(calls.token[0].body).toBe("grant_type=client_credentials");

    // The token lives 3600 s and is renewed 60 s early: still reused 1 ms before that point...
    clock.now = base + 3_540_000 - 1;
    expect(await client.accessToken()).toBe("token-1");
    expect(calls.token).toHaveLength(1);

    // ...and replaced at the point itself.
    clock.now = base + 3_540_000;
    expect(await client.accessToken()).toBe("token-2");
    expect(calls.token).toHaveLength(2);
  });

  it("serves two charges with one token, and an order sent after expiry carries the new one", async () => {
    const { client, calls, clock } = setup({ orders: [() => completed(), () => completed(), () => completed()] });
    await charge(client);
    await charge(client);
    expect(calls.token).toHaveLength(1);
    expect(calls.order.map((c) => c.headers.Authorization)).toEqual(["Bearer token-1", "Bearer token-1"]);

    clock.now += 3_600_000;
    await charge(client);
    expect(calls.token).toHaveLength(2);
    expect(calls.order[2].headers.Authorization).toBe("Bearer token-2");
  });
});

describe("PayPal sandbox client: the order request", () => {
  it("sends the attempt's request ID and an item total equal to the sum of the items", async () => {
    const { client, calls } = setup({ orders: [() => completed()] });
    const result = await charge(client);

    expect(result).toEqual({ status: "captured", orderId: "ORDER-1", captureId: "CAP-1", amountCents: 2200, at: "2026-11-12T03:00:00Z" });
    expect(calls.order).toHaveLength(1);
    const order = calls.order[0];
    expect(order.url).toBe(`${SANDBOX_API}/v2/checkout/orders`);
    expect(order.method).toBe("POST");
    expect(order.headers["PayPal-Request-Id"]).toBe(REQUEST_ID);

    const body = JSON.parse(order.body ?? "{}");
    const unit = body.purchase_units[0];
    expect(unit.reference_id).toBe(REQUEST_ID);
    expect(unit.amount.value).toBe("22.00");
    expect(unit.amount.breakdown.item_total.value).toBe("22.00");
    expect(body.payment_source.paypal.vault_id).toBe("VAULT-1");
    expect(body.intent).toBe("CAPTURE");
  });

  it("sends an item total equal to the sum of its items, for any cart", async () => {
    const itemArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 40 }),
      quantity: fc.integer({ min: 1, max: 10 }),
      unitCents: fc.integer({ min: 1, max: 60_000 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(itemArb, { minLength: 1, maxLength: 6 }), async (items) => {
        const { client, calls } = setup({ orders: [() => completed()] });
        await charge(client, items);
        const body = JSON.parse(calls.order[0].body ?? "{}");
        const unit = body.purchase_units[0];
        const sumCents = items.reduce((s, i) => s + i.unitCents * i.quantity, 0);
        const toCents = (v: string) => Math.round(Number(v) * 100);
        expect(toCents(unit.amount.breakdown.item_total.value)).toBe(sumCents);
        expect(toCents(unit.amount.value)).toBe(sumCents);
        const lineSum = unit.items.reduce(
          (s: number, i: { quantity: string; unit_amount: { value: string } }) => s + toCents(i.unit_amount.value) * Number(i.quantity),
          0,
        );
        expect(lineSum).toBe(sumCents);
        expect(calls.order[0].headers["PayPal-Request-Id"]).toBe(REQUEST_ID);
      }),
      { numRuns: 200 },
    );
  });
});

describe("PayPal sandbox client: refusals and retries", () => {
  it("refuses a 4xx with PayPal's upper-case issue code, once, and never repeats the order", async () => {
    const { client, calls } = setup({
      orders: [
        () =>
          failure(422, {
            name: "UNPROCESSABLE_ENTITY",
            message: `Request failed for ${CLIENT_SECRET}`,
            details: [{ issue: "INSTRUMENT_DECLINED", description: `Declined for ${CLIENT_SECRET}` }],
          }),
      ],
    });
    const result = await charge(client);
    expect(result).toEqual({ status: "refused", reason: "INSTRUMENT_DECLINED" });
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
    expect(calls.order).toHaveLength(1);
  });

  it("replaces free-text issues with the HTTP status, so nothing echoed from the request leaks", async () => {
    const { client } = setup({
      orders: [() => failure(400, { details: [{ issue: `card for ${CLIENT_SECRET} was declined` }] })],
    });
    const result = await charge(client);
    expect(result).toEqual({ status: "refused", reason: "HTTP_400" });
  });

  it("refuses a 4xx whose body is not JSON, with the HTTP status", async () => {
    const { client } = setup({ orders: [() => new Response("<html>nope</html>", { status: 404 })] });
    expect(await charge(client)).toEqual({ status: "refused", reason: "HTTP_404" });
  });

  it("repeats a 5xx with the same request ID and body, and reports the capture if the repeat succeeds", async () => {
    const { client, calls } = setup({ orders: [() => failure(503, { name: "SERVICE_UNAVAILABLE" }), () => completed()] });
    const result = await charge(client);
    expect(result.status).toBe("captured");
    expect(calls.order).toHaveLength(2);
    expect(calls.order[1].headers["PayPal-Request-Id"]).toBe(calls.order[0].headers["PayPal-Request-Id"]);
    expect(calls.order[1].body).toBe(calls.order[0].body);
  });

  it("reports unknown, never refused, when a 5xx repeats", async () => {
    const { client, calls } = setup({
      orders: [() => failure(500, { name: "INTERNAL_SERVER_ERROR" }), () => failure(502, { name: "BAD_GATEWAY" })],
    });
    const result = await charge(client);
    expect(result.status).toBe("unknown");
    expect(calls.order).toHaveLength(2);
  });

  it.each([
    ["a TimeoutError", () => new DOMException("The operation timed out.", "TimeoutError")],
    ["an AbortError", () => Object.assign(new Error("aborted"), { name: "AbortError" })],
  ])("reports unknown after two timeouts (%s), because the charge may have gone through", async (_label, make) => {
    const { client, calls } = setup({
      orders: [
        () => {
          throw make();
        },
        () => {
          throw make();
        },
      ],
    });
    const result = await charge(client);
    expect(result).toEqual({ status: "unknown", reason: "PayPal timed out" });
    expect(calls.order).toHaveLength(2);
  });

  it("reports unknown when the connection fails twice after the order may have been sent", async () => {
    const dropped = () => {
      throw new TypeError("fetch failed");
    };
    const { client } = setup({ orders: [dropped, dropped] });
    expect((await charge(client)).status).toBe("unknown");
  });

  it("reports captured when a timeout is followed by an order PayPal did complete", async () => {
    const { client, calls } = setup({
      orders: [
        () => {
          throw timeout();
        },
        () => completed(),
      ],
    });
    expect((await charge(client)).status).toBe("captured");
    expect(calls.order).toHaveLength(2);
  });

  it("refuses RATE_LIMITED after two 429s when no order was ever sent", async () => {
    const { client, calls } = setup({ orders: [() => failure(429, { name: "RATE_LIMIT_REACHED" }), () => failure(429, { name: "RATE_LIMIT_REACHED" })] });
    expect(await charge(client)).toEqual({ status: "refused", reason: "RATE_LIMITED" });
    expect(calls.order).toHaveLength(2);
  });

  it("captures when a 429 is followed by success", async () => {
    const { client } = setup({ orders: [() => failure(429, {}), () => completed()] });
    expect((await charge(client)).status).toBe("captured");
  });

  it("reports unknown, not refused, for a 429 that follows a 5xx (the first order may have moved money)", async () => {
    const { client } = setup({ orders: [() => failure(503, {}), () => failure(429, {})] });
    expect(await charge(client)).toEqual({ status: "unknown", reason: "RATE_LIMITED" });
  });

  it("reports unknown for a DUPLICATE issue and does not repeat the order", async () => {
    const { client, calls } = setup({
      orders: [() => failure(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_REQUEST_ID" }] })],
    });
    expect(await charge(client)).toEqual({ status: "unknown", reason: "DUPLICATE_REQUEST_ID" });
    expect(calls.order).toHaveLength(1);
  });

  it("reports unknown when a timeout is followed by PREVIOUS_REQUEST_IN_PROGRESS (the first request may still capture)", async () => {
    const { client, calls } = setup({
      orders: [
        () => {
          throw timeout();
        },
        () => failure(409, { name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] }),
      ],
    });
    expect(await charge(client)).toEqual({ status: "unknown", reason: "PREVIOUS_REQUEST_IN_PROGRESS" });
    expect(calls.order).toHaveLength(2);
  });

  it("refuses a definite refusal of the repeat after a timeout (PayPal answers a repeated request ID with the first result)", async () => {
    const { client } = setup({
      orders: [
        () => {
          throw timeout();
        },
        () => failure(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }),
      ],
    });
    expect(await charge(client)).toEqual({ status: "refused", reason: "INSTRUMENT_DECLINED" });
  });

  it("reports unknown for a 401 on the repeat after a timeout, since it says nothing about the first request", async () => {
    const { client } = setup({
      orders: [
        () => {
          throw timeout();
        },
        () => failure(401, { name: "AUTHENTICATION_FAILURE" }),
      ],
    });
    expect((await charge(client)).status).toBe("unknown");
  });

  it("reports unknown for any 409, even with no readable body", async () => {
    const { client, calls } = setup({ orders: [() => new Response("<html>conflict</html>", { status: 409 })] });
    expect((await charge(client)).status).toBe("unknown");
    expect(calls.order).toHaveLength(1);
  });

  it("refuses a settling repeat that PayPal declines, so the hold is released and the attempt does not stay open", async () => {
    const { client, calls } = setup({
      orders: [() => failure(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] })],
    });
    const result = await client.charge({ vaultId: "VAULT-1", requestId: "attempt-1", items: [{ name: "Dish soap", quantity: 1, unitCents: 400 }], description: "d", repeat: true });
    expect(result).toEqual({ status: "refused", reason: "INSTRUMENT_DECLINED" });
    expect(calls.order).toHaveLength(1);
  });

  it("reports unknown for a first-request 409 PREVIOUS_REQUEST_IN_PROGRESS (a double click racing the same request ID)", async () => {
    const { client } = setup({
      orders: [() => failure(409, { name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] })],
    });
    expect(await charge(client)).toEqual({ status: "unknown", reason: "PREVIOUS_REQUEST_IN_PROGRESS" });
  });

  it("reports unknown, not refused, when a repeat that settles an earlier attempt cannot get a token", async () => {
    const { client, calls } = setup({ token: () => failure(503, {}) });
    const result = await client.charge({ vaultId: "VAULT-1", requestId: "attempt-1", items: [{ name: "Dish soap", quantity: 1, unitCents: 400 }], description: "d", repeat: true });
    expect(result.status).toBe("unknown");
    expect(calls.order).toHaveLength(0);
  });

  it("still refuses a first-request refusal, when no order can have gone through", async () => {
    const { client } = setup({ orders: [() => failure(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] })] });
    expect(await charge(client)).toEqual({ status: "refused", reason: "INSTRUMENT_DECLINED" });
  });

  it("reports unknown CAPTURE_PENDING when the order is COMPLETED but the capture is PENDING", async () => {
    const { client } = setup({ orders: [() => pendingCapture()] });
    expect(await charge(client)).toEqual({ status: "unknown", reason: "CAPTURE_PENDING" });
  });
});

describe("PayPal sandbox client: the token endpoint failing", () => {
  it("refuses PAYPAL_UNREACHABLE, without sending any order, when the token request is rejected", async () => {
    const { client, calls } = setup({ token: () => failure(503, {}) });
    expect(await charge(client)).toEqual({ status: "refused", reason: "PAYPAL_UNREACHABLE" });
    expect(calls.order).toHaveLength(0);
  });

  it("refuses PAYPAL_UNREACHABLE, without sending any order, when the token request cannot connect", async () => {
    const { client, calls } = setup({
      token: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await charge(client)).toEqual({ status: "refused", reason: "PAYPAL_UNREACHABLE" });
    expect(calls.order).toHaveLength(0);
  });

  it("reports unknown, not refused, when an order timed out and the token cannot be renewed for the retry", async () => {
    const { client, calls } = setup({
      // The first token lives 100 s, so it is still valid when the order is sent.
      token: (n) => (n === 1 ? tokenResponse(n, 100) : failure(503, {})),
      orders: [
        (clock) => {
          clock.now += 120_000; // The timeout took long enough for the token to expire.
          throw timeout();
        },
      ],
    });
    const result = await charge(client);
    expect(result).toEqual({ status: "unknown", reason: "PAYPAL_UNREACHABLE" });
    expect(calls.order).toHaveLength(1);
    expect(calls.token).toHaveLength(2);
  });
});

describe("plainReason", () => {
  it("passes on upper-case codes only", () => {
    expect(plainReason(422, { details: [{ issue: "INSTRUMENT_DECLINED" }] })).toBe("INSTRUMENT_DECLINED");
    expect(plainReason(400, { name: "INVALID_REQUEST" })).toBe("INVALID_REQUEST");
    expect(plainReason(400, { name: "invalid request for secret" })).toBe("HTTP_400");
    expect(plainReason(500, null)).toBe("HTTP_500");
  });
});
