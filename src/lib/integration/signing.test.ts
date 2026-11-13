import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { secretList, signature, signedHeaders, verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signing.ts";

// The same vectors are checked in PeakSwift Leads (src/lib/website-examples/signing.test.ts).
const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "signing-vectors.json"), "utf8")) as {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  body: string;
  signature: string;
}[];

test("the shared vectors still produce the agreed signatures", () => {
  for (const v of vectors) assert.equal(signature(v.secret, v.timestamp, v.method, v.path, v.body), v.signature);
});

const secret = "s".repeat(40);

test("a fresh signature verifies; tampering with anything signed does not", () => {
  const now = 1_794_571_200_000;
  const body = '{"a":1}';
  const headers = signedHeaders(secret, "POST", "/api/website-examples/webhook", body, now);
  const base = { secrets: [secret], signature: headers[SIGNATURE_HEADER], timestamp: headers[TIMESTAMP_HEADER], method: "POST", path: "/api/website-examples/webhook", body, nowMs: now };
  assert.deepEqual(verifySignature(base), { ok: true });
  assert.deepEqual(verifySignature({ ...base, body: '{"a":2}' }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifySignature({ ...base, path: "/api/leads-file/x" }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifySignature({ ...base, method: "GET" }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifySignature({ ...base, nowMs: now + 301_000 }), { ok: false, reason: "stale" });
  assert.deepEqual(verifySignature({ ...base, signature: "" }), { ok: false, reason: "missing" });
  assert.deepEqual(verifySignature({ ...base, secrets: [] }), { ok: false, reason: "not_configured" });
});

test("short secrets are ignored and rotation accepts either secret", () => {
  assert.deepEqual(secretList("short, " + secret), [secret]);
  const old = "o".repeat(40);
  const now = Date.now();
  const headers = signedHeaders(old, "GET", "/p", "", now);
  assert.equal(verifySignature({ secrets: [secret, old], signature: headers[SIGNATURE_HEADER], timestamp: headers[TIMESTAMP_HEADER], method: "GET", path: "/p", body: "", nowMs: now }).ok, true);
});
