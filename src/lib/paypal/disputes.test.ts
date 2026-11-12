// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SANDBOX_API } from "./client";
import {
  SandboxDisputes,
  asciiOnly,
  buildMultipart,
  canProvideEvidence,
  encodeEvidenceFile,
  parseDetail,
  parseSummaries,
  textToPdf,
} from "./disputes";

const tokens = { accessToken: async () => "TEST-TOKEN" };

function reply(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("reading PayPal's dispute answers", () => {
  it("reads the summary list", () => {
    expect(
      parseSummaries({ items: [{ dispute_id: "PP-D-1", status: "OPEN" }, { dispute_id: "PP-D-2" }, "junk"] }),
    ).toEqual([{ id: "PP-D-1", status: "OPEN" }]);
    expect(parseSummaries({})).toEqual([]);
  });

  it("reads the capture IDs, the provide-evidence link and the request for the seller", () => {
    const d = parseDetail({
      dispute_id: "PP-D-1",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "UNAUTHORISED",
      disputed_transactions: [{ seller_transaction_id: "CAP-A", buyer_transaction_id: "BUY-A" }, { seller_transaction_id: "CAP-B" }],
      links: [{ rel: "self" }, { rel: "provide-evidence", href: "https://x", method: "POST" }],
      evidences: [{ evidence_type: "OTHER", source: "REQUESTED_FROM_SELLER" }],
    });
    expect(d).toEqual({
      id: "PP-D-1",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "UNAUTHORISED",
      captureIds: ["CAP-A", "CAP-B"],
      hasProvideEvidenceLink: true,
      evidenceRequestedFromSeller: true,
    });
    expect(canProvideEvidence(d)).toBe(true);
  });

  it("needs both the link and the request: either one alone is not enough", () => {
    const base = { dispute_id: "PP-D-1", status: "OPEN", disputed_transactions: [] };
    const linkOnly = parseDetail({ ...base, links: [{ rel: "provide-evidence" }], evidences: [{ source: "SUBMITTED_BY_BUYER" }] });
    const requestOnly = parseDetail({ ...base, links: [{ rel: "self" }], evidences: [{ source: "REQUESTED_FROM_SELLER" }] });
    expect(canProvideEvidence(linkOnly)).toBe(false);
    expect(canProvideEvidence(requestOnly)).toBe(false);
    expect(() => parseDetail({ status: "OPEN" })).toThrow();
  });
});

describe("the sandbox adapter", () => {
  it("asks the sandbox for the list and one dispute, with the bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("?page_size")
        ? reply(200, { items: [{ dispute_id: "PP-D-1", status: "OPEN" }] })
        : reply(200, { dispute_id: "PP-D-1", status: "OPEN", disputed_transactions: [{ seller_transaction_id: "CAP-1" }] }),
    );
    const port = new SandboxDisputes(tokens, { fetch: fetchMock });
    expect(await port.listRecent()).toEqual([{ id: "PP-D-1", status: "OPEN" }]);
    expect((await port.get("PP-D-1")).captureIds).toEqual(["CAP-1"]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${SANDBOX_API}/v1/customer/disputes?page_size=50`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${SANDBOX_API}/v1/customer/disputes/PP-D-1`);
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-TOKEN");
  });

  it("sends the evidence as multipart form data: an input part with no filename, then a PDF file part", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init! };
      return reply(200, { links: [] });
    });
    const port = new SandboxDisputes(tokens, { fetch: fetchMock as unknown as typeof fetch });
    const result = await port.provideEvidence("PP-D-1", {
      notes: "Mandate hash abc × 2",
      document: { name: "allowance-evidence.pdf", json: '{"a": "(b)"}' },
    });
    expect(result).toEqual({ ok: true });
    expect(seen!.url).toBe(`${SANDBOX_API}/v1/customer/disputes/PP-D-1/provide-evidence`);
    expect(seen!.init.method).toBe("POST");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TEST-TOKEN");
    const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(headers["Content-Type"])?.[1];
    expect(boundary).toBeTruthy();

    const body = Buffer.from(seen!.init.body as Uint8Array).toString("latin1");
    expect(body.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n`)).toBe(true);
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
    const inputJson = body.split("\r\n\r\n")[1].split(`\r\n--${boundary}`)[0];
    expect(JSON.parse(inputJson)).toEqual({
      evidences: [{ evidence_type: "OTHER", notes: "Mandate hash abc x 2", documents: [{ name: "allowance-evidence.pdf" }] }],
    });
    expect(body).toContain(
      `Content-Disposition: form-data; name="evidence-file"; filename="allowance-evidence.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4`,
    );
    expect(body).toContain("%%EOF");
  });

  it("turns a 4xx into a plain reason that is not retried, and an outage into one that is", async () => {
    const make = (res: () => Promise<Response>) => new SandboxDisputes(tokens, { fetch: (async () => res()) as unknown as typeof fetch });
    const ev = { notes: "n", document: { name: "d.pdf", json: "{}" } };
    expect(
      await make(async () => reply(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ACTION_NOT_ALLOWED", description: "free text with a secret" }] })).provideEvidence("PP-D-1", ev),
    ).toEqual({ ok: false, reason: "ACTION_NOT_ALLOWED" });
    expect(await make(async () => reply(400, "not json")).provideEvidence("PP-D-1", ev)).toEqual({ ok: false, reason: "HTTP_400" });
    expect(await make(async () => reply(503, {})).provideEvidence("PP-D-1", ev)).toEqual({ ok: false, reason: "HTTP_503", retryable: true });
    expect(await make(async () => reply(429, {})).provideEvidence("PP-D-1", ev)).toEqual({ ok: false, reason: "RATE_LIMITED", retryable: true });
    expect(
      await make(async () => {
        throw new TypeError("network down");
      }).provideEvidence("PP-D-1", ev),
    ).toEqual({ ok: false, reason: "PAYPAL_UNREACHABLE", retryable: true });
  });

  it("checks a webhook by posting PayPal's headers and the event text exactly as it arrived", async () => {
    let posted = "";
    let url = "";
    const fetchMock = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      posted = String(init!.body);
      return reply(200, { verification_status: "SUCCESS" });
    });
    const port = new SandboxDisputes(tokens, { fetch: fetchMock as unknown as typeof fetch });
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-transmission-id": "tid-1",
      "paypal-transmission-sig": "c2ln",
      "paypal-transmission-time": "2026-11-12T15:00:00Z",
    };
    // Spacing and key order that a parse and re-stringify would change.
    const rawBody = '{ "id" : "WH-1",  "resource": {"dispute_id":"PP-D-1"} }';
    expect(await port.verifyWebhook({ webhookId: "WH-ID", headers, rawBody })).toBe(true);
    expect(url).toBe(`${SANDBOX_API}/v1/notifications/verify-webhook-signature`);
    expect(posted.endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
    expect(JSON.parse(posted)).toMatchObject({ auth_algo: "SHA256withRSA", transmission_id: "tid-1", webhook_id: "WH-ID" });
  });

  it("refuses a webhook without calling PayPal when a header is missing or the body is not JSON, and when PayPal says FAILURE", async () => {
    const fetchMock = vi.fn(async () => reply(200, { verification_status: "FAILURE" }));
    const port = new SandboxDisputes(tokens, { fetch: fetchMock as unknown as typeof fetch });
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://x",
      "paypal-transmission-id": "t",
      "paypal-transmission-sig": "s",
      "paypal-transmission-time": "2026-11-12T15:00:00Z",
    };
    expect(await port.verifyWebhook({ webhookId: "W", headers: { ...headers, "paypal-transmission-sig": undefined }, rawBody: "{}" })).toBe(false);
    expect(await port.verifyWebhook({ webhookId: "W", headers, rawBody: "not json" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await port.verifyWebhook({ webhookId: "W", headers, rawBody: "{}" })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the evidence file", () => {
  it("is a PDF whose cross-reference table points at every object", () => {
    const pdf = textToPdf(`${"line (with) parens \\ and a × sign\n".repeat(150)}`).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const count = Number(/\/Size (\d+)/.exec(pdf)![1]);
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
    const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(count - 1);
    entries.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(pdf).toContain("line \\(with\\) parens \\\\ and a x sign");
  });

  it("names the file after the document and always ends in .pdf", () => {
    expect(encodeEvidenceFile({ name: "allowance-evidence.json", json: "{}" }).filename).toBe("allowance-evidence.pdf");
    expect(encodeEvidenceFile({ name: "../we ird/na(me).txt", json: "{}" }).filename).toMatch(/^[A-Za-z0-9-_,\s]+\.pdf$/);
  });

  it("keeps only plain text for the notes and the PDF", () => {
    expect(asciiOnly("2 × café\r\nline\t2")).toBe("2 x caf?\nline  2");
  });

  it("builds a multipart body whose boundary is not in the data", () => {
    const { body, contentType } = buildMultipart([{ name: "a", contentType: "text/plain", data: "x" }]);
    const boundary = contentType.split("boundary=")[1];
    expect(body.toString()).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="a"\r\nContent-Type: text/plain\r\n\r\nx\r\n--${boundary}--\r\n`);
  });
});
