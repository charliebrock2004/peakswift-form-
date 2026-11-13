// Request signing for the PeakSwift Forms ⇄ PeakSwift Leads integration.
//
// SHARED CONTRACT — byte-identical copies live in both repositories:
//   peakswift-form-  src/lib/integration/signing.ts
//   peakswift_big-   src/lib/website-examples/signing.ts
// Both test suites check the same vectors (signing-vectors.json), so a change
// on one side that the other does not share fails a test, not production.
//
// Used in both directions with one shared secret, FORMS_INTEGRATION_SECRET:
//   Forms -> Leads  POST /api/website-examples/webhook   (a submitted request)
//   Leads -> Forms  GET  /api/leads-file/<fileId>         (one private image)
//
// Signature = HMAC-SHA256(secret, `${timestamp}.${METHOD}.${path}.${sha256(body)}`)
// sent as `x-peakswift-signature: v1=<hex>` with `x-peakswift-timestamp: <unix seconds>`.
// The method and path (with query string) are signed, so a signature for one
// endpoint cannot be replayed against another, and a request more than five
// minutes old (or ahead) is refused. Several secrets may be configured
// (comma-separated, newest first) to rotate without downtime.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-peakswift-signature";
export const TIMESTAMP_HEADER = "x-peakswift-timestamp";
export const IDEMPOTENCY_HEADER = "idempotency-key";
export const TOLERANCE_SECONDS = 300;
export const MIN_SECRET_LENGTH = 32;

export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function canonicalString(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${bodyDigest(body)}`;
}

export function signature(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(canonicalString(timestamp, method, path, body), "utf8").digest("hex");
}

export function signedHeaders(secret: string, method: string, path: string, body: string, nowMs: number = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature(secret, timestamp, method, path, body) };
}

/** Configured secrets, newest first. Values shorter than MIN_SECRET_LENGTH are ignored. */
export function secretList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SECRET_LENGTH);
}

export type VerifyResult = { ok: true } | { ok: false; reason: "not_configured" | "missing" | "stale" | "bad_signature" };

export function verifySignature(input: {
  secrets: readonly string[];
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  method: string;
  path: string;
  body: string;
  nowMs?: number;
}): VerifyResult {
  if (!input.secrets.length) return { ok: false, reason: "not_configured" };
  const sig = (input.signature ?? "").trim();
  const ts = (input.timestamp ?? "").trim();
  if (!sig || !/^\d{9,11}$/.test(ts)) return { ok: false, reason: "missing" };
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(ts)) > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const given = Buffer.from(sig, "utf8");
  for (const secret of input.secrets) {
    const expected = Buffer.from(signature(secret, ts, input.method, input.path, input.body), "utf8");
    if (expected.length === given.length && timingSafeEqual(expected, given)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
