// The disputes port (U15): list disputes, read one, send evidence, check a webhook. The sandbox
// adapter below and the fake in disputes-fake.ts both implement it. Like the rest of the
// PayPal code, the address is fixed to PayPal's sandbox.
import { randomBytes } from "node:crypto";
import { SANDBOX_API, plainReason } from "./client";

const TIMEOUT_MS = 15_000;
/** The most PayPal's schema allows. The list's order is not documented, so ask for as many as possible. */
const LIST_PAGE_SIZE = 50;

export interface DisputeSummary {
  id: string;
  /** PayPal's overall status, such as WAITING_FOR_SELLER_RESPONSE, UNDER_REVIEW or RESOLVED. */
  status: string;
}

export interface DisputeDetail {
  id: string;
  status: string;
  reason: string | null;
  /** Every `seller_transaction_id` PayPal lists for the dispute. For a capture this is the capture ID. */
  captureIds: string[];
  /** The dispute carries the `provide-evidence` HATEOAS link. */
  hasProvideEvidenceLink: boolean;
  /** An `evidences` entry has `source: "REQUESTED_FROM_SELLER"`. */
  evidenceRequestedFromSeller: boolean;
}

export interface EvidenceInput {
  /** Free text for PayPal, at most 2,000 characters. */
  notes: string;
  /** The full record. `json` is the text of the record. The adapter turns it into the uploaded file. */
  document: { name: string; json: string };
}

export type EvidenceResult =
  | { ok: true }
  /**
   * `retryable` is set when PayPal could not be reached or had an error on its side. A refusal
   * (a 4xx answer) is never retryable: sending the same evidence again cannot change it.
   */
  | { ok: false; reason: string; retryable?: boolean };

export interface DisputesPort {
  /** Recent disputes, a summary each. The summary has no transaction IDs: call `get` to match one. */
  listRecent(): Promise<DisputeSummary[]>;
  get(id: string): Promise<DisputeDetail>;
  /** Never throws: a timeout or an error becomes `{ ok: false }`. */
  provideEvidence(id: string, evidence: EvidenceInput): Promise<EvidenceResult>;
  /** True only when PayPal confirms the webhook came from PayPal. Never throws. */
  verifyWebhook(args: { webhookId: string; headers: Record<string, string | undefined>; rawBody: string }): Promise<boolean>;
}

/**
 * The one rule that allows sending evidence (KTD14). PayPal's docs disagree on the stage, so
 * the link is the gate, together with an evidence request addressed to the seller.
 */
export function canProvideEvidence(d: Pick<DisputeDetail, "hasProvideEvidenceLink" | "evidenceRequestedFromSeller">): boolean {
  return d.hasProvideEvidenceLink && d.evidenceRequestedFromSeller;
}

/** PayPal's upload types are jpg, jpeg, gif, png and pdf, so plain text must go up as a PDF. */
export const EVIDENCE_CONTENT_TYPE = "application/pdf";

/** ASCII only: the PDF uses a built-in font, and PayPal's notes pattern is plain text. */
export function asciiOnly(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/×/g, "x")
    .replace(/[^\n\x20-\x7e]/g, "?");
}

function pdfEscape(line: string): string {
  return line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A small text-only PDF: Courier 8 pt, 100 columns, 66 lines a page. */
export function textToPdf(text: string): Buffer {
  const COLUMNS = 100;
  const LINES_PER_PAGE = 66;
  const lines: string[] = [];
  for (const raw of asciiOnly(text).split("\n")) {
    if (raw.length === 0) lines.push("");
    for (let i = 0; i < raw.length; i += COLUMNS) lines.push(raw.slice(i, i + COLUMNS));
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (pages.length === 0) pages.push([""]);

  // Objects: 1 catalog, 2 page list, 3 font, then a page and its content for each page.
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, k) => `${4 + 2 * k} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  pages.forEach((pageLines, k) => {
    const stream = `BT\n/F1 8 Tf\n10 TL\n40 752 Td\n${pageLines.map((l) => `(${pdfEscape(l)}) Tj\nT*`).join("\n")}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * k} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * The one place that decides how the evidence record becomes an uploaded file. To change the
 * file type after a sandbox try, change only this function and EVIDENCE_CONTENT_TYPE.
 */
export function encodeEvidenceFile(document: { name: string; json: string }): { filename: string; contentType: string; bytes: Buffer } {
  const base = document.name.replace(/\.[A-Za-z]+$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "allowance-evidence";
  return { filename: `${base}.pdf`, contentType: EVIDENCE_CONTENT_TYPE, bytes: textToPdf(document.json) };
}

export const MAX_NOTES_CHARS = 2000;

interface Part {
  name: string;
  contentType: string;
  data: Buffer | string;
  filename?: string;
}

/** Builds a multipart/form-data body by hand, the same bytes `curl -F` sends. */
export function buildMultipart(parts: Part[]): { body: Buffer; contentType: string } {
  const boundary = `----AllowanceEvidence${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${part.contentType}\r\n\r\n`, "latin1"));
    chunks.push(typeof part.data === "string" ? Buffer.from(part.data, "utf8") : part.data);
    chunks.push(Buffer.from("\r\n", "latin1"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "latin1"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

type FetchLike = typeof fetch;

interface TokenSource {
  accessToken(): Promise<string>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function str(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}

class DisputesHttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown> | null,
  ) {
    super(`PayPal returned ${status}`);
  }
}

export function parseSummaries(json: unknown): DisputeSummary[] {
  const items = isRecord(json) ? asArray(json.items) : [];
  const out: DisputeSummary[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = str(item.dispute_id);
    const status = str(item.status);
    if (id && status) out.push({ id, status });
  }
  return out;
}

export function parseDetail(json: unknown): DisputeDetail {
  if (!isRecord(json)) throw new Error("PayPal sent a dispute that could not be read.");
  const id = str(json.dispute_id);
  const status = str(json.status);
  if (!id || !status) throw new Error("PayPal sent a dispute that could not be read.");
  const captureIds = asArray(json.disputed_transactions)
    .map((t) => (isRecord(t) ? str(t.seller_transaction_id) : null))
    .filter((v): v is string => v !== null);
  const hasProvideEvidenceLink = asArray(json.links).some((l) => isRecord(l) && l.rel === "provide-evidence");
  const evidenceRequestedFromSeller = asArray(json.evidences).some((e) => isRecord(e) && e.source === "REQUESTED_FROM_SELLER");
  return { id, status, reason: str(json.reason), captureIds, hasProvideEvidenceLink, evidenceRequestedFromSeller };
}

export class SandboxDisputes implements DisputesPort {
  constructor(
    private readonly tokens: TokenSource,
    private readonly opts: { fetch?: FetchLike } = {},
  ) {}

  private get fetchImpl(): FetchLike {
    return this.opts.fetch ?? fetch;
  }

  private async request(method: "GET" | "POST", path: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Record<string, unknown>> {
    const token = await this.tokens.accessToken();
    const res = await this.fetchImpl(`${SANDBOX_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      json = isRecord(parsed) ? parsed : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new DisputesHttpError(res.status, json);
    return json ?? {};
  }

  async listRecent(): Promise<DisputeSummary[]> {
    return parseSummaries(await this.request("GET", `/v1/customer/disputes?page_size=${LIST_PAGE_SIZE}`, { headers: { Accept: "application/json" } }));
  }

  async get(id: string): Promise<DisputeDetail> {
    return parseDetail(await this.request("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }));
  }

  async provideEvidence(id: string, evidence: EvidenceInput): Promise<EvidenceResult> {
    try {
      const file = encodeEvidenceFile(evidence.document);
      const input = {
        evidences: [
          {
            evidence_type: "OTHER",
            notes: asciiOnly(evidence.notes).slice(0, MAX_NOTES_CHARS),
            documents: [{ name: file.filename }],
          },
        ],
      };
      // Same shape as PayPal's `curl -F 'input={...};type=application/json'` example, plus the
      // file. The file part is named `evidence-file`, the name in the public API schema.
      const multipart = buildMultipart([
        { name: "input", contentType: "application/json", data: JSON.stringify(input) },
        { name: "evidence-file", filename: file.filename, contentType: file.contentType, data: file.bytes },
      ]);
      await this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, {
        headers: { "Content-Type": multipart.contentType, Accept: "application/json" },
        body: new Uint8Array(multipart.body),
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof DisputesHttpError) {
        if (err.status >= 500 || err.status === 429) {
          return { ok: false, reason: err.status === 429 ? "RATE_LIMITED" : plainReason(err.status, err.body), retryable: true };
        }
        return { ok: false, reason: plainReason(err.status, err.body) };
      }
      return { ok: false, reason: "PAYPAL_UNREACHABLE", retryable: true };
    }
  }

  async verifyWebhook(args: { webhookId: string; headers: Record<string, string | undefined>; rawBody: string }): Promise<boolean> {
    try {
      const h = (name: string) => args.headers[name]?.trim();
      const algo = h("paypal-auth-algo");
      const certUrl = h("paypal-cert-url");
      const id = h("paypal-transmission-id");
      const sig = h("paypal-transmission-sig");
      const time = h("paypal-transmission-time");
      if (!algo || !certUrl || !id || !sig || !time || !args.webhookId) return false;
      JSON.parse(args.rawBody); // not JSON: refuse before asking PayPal
      // PayPal checks the event exactly as it arrived, so the raw text goes in unchanged.
      const body =
        `{"auth_algo":${JSON.stringify(algo)},"cert_url":${JSON.stringify(certUrl)},"transmission_id":${JSON.stringify(id)},` +
        `"transmission_sig":${JSON.stringify(sig)},"transmission_time":${JSON.stringify(time)},"webhook_id":${JSON.stringify(args.webhookId)},` +
        `"webhook_event":${args.rawBody}}`;
      const json = await this.request("POST", "/v1/notifications/verify-webhook-signature", {
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
      });
      return json.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }
}
