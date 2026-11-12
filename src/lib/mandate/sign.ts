/**
 * Signing for mandates. Uses node:crypto only.
 *
 * The signing key is derived from one server secret with HKDF, so no key
 * file is stored. The signature covers the canonical JSON of the mandate:
 * keys sorted, no whitespace, so the same rules always give the same bytes.
 *
 * NOTE for callers: verifySignedMandate checks the signature against the
 * public key INSIDE the signed record. That proves the record was not edited
 * after signing. To prove WE signed it, also compare `publicKey` with
 * deriveSigningKey(secret).publicKeyBase64.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import type { IntentMandate } from "./schema";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MIN_SECRET_LENGTH = 16;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * JSON with keys sorted recursively (by UTF-16 code unit), no whitespace,
 * arrays in their given order. Only plain objects, arrays, strings, finite
 * numbers, booleans and null are allowed. Anything else throws.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: numbers must be finite.");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new TypeError("canonicalJson: only plain objects and arrays are allowed.");
      }
      const keys = Object.keys(value).sort();
      const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: ${typeof value} values are not allowed.`);
  }
}

/** SHA-256 of the mandate's canonical JSON, as hex. */
export function mandateHash(m: IntentMandate): string {
  return createHash("sha256").update(canonicalJson(m), "utf8").digest("hex");
}

/** Ed25519 key pair derived from a server secret (16 characters or more). */
export function deriveSigningKey(secret: string): { privateKey: KeyObject; publicKeyBase64: string } {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`The signing secret must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  const seed = Buffer.from(hkdfSync("sha256", secret, "allowance-mandate-v1", "ed25519-seed", 32));
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKeyBase64 = spki.subarray(spki.length - 32).toString("base64");
  return { privateKey, publicKeyBase64 };
}

export interface SignedMandate {
  mandate: IntentMandate;
  /** SHA-256 hex of the canonical JSON of `mandate`. */
  hash: string;
  /** Base64 Ed25519 signature over the canonical JSON bytes. */
  signature: string;
  /** Base64 of the raw 32-byte Ed25519 public key. */
  publicKey: string;
}

export function signMandate(m: IntentMandate, secret: string): SignedMandate {
  const { privateKey, publicKeyBase64 } = deriveSigningKey(secret);
  const canonical = canonicalJson(m);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const signature = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  return { mandate: m, hash, signature, publicKey: publicKeyBase64 };
}

/** Decodes base64 only when it is canonical and has the expected byte length. */
function decodeBase64(value: unknown, length: number): Buffer | null {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== value) return null;
  return bytes;
}

/** True only when the hash matches the mandate and the signature matches the bytes. Never throws. */
export function verifySignedMandate(s: SignedMandate): boolean {
  try {
    if (typeof s !== "object" || s === null) return false;
    const { mandate, hash, signature, publicKey } = s;
    if (typeof hash !== "string") return false;

    const canonical = canonicalJson(mandate);
    const expectedHash = createHash("sha256").update(canonical, "utf8").digest("hex");
    if (hash !== expectedHash) return false;

    const rawPublicKey = decodeBase64(publicKey, 32);
    const signatureBytes = decodeBase64(signature, 64);
    if (rawPublicKey === null || signatureBytes === null) return false;

    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(canonical, "utf8"), key, signatureBytes);
  } catch {
    return false;
  }
}
