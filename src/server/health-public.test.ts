import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronAuthorised, HEALTH_HEADERS, publicHealth } from "./health-public.ts";

const fullReport = {
  ok: true,
  commit: "76a93c7",
  environment: "production",
  branch: "main",
  database: "connected",
  databaseError: null,
  schema: "ready",
  email: "configured",
  emailProvider: "resend",
  emailProblem: null,
  emailVariables: { RESEND_API_KEY: "set", SMPT_USER: "set" },
  emailRecipient: "owner@example.test",
  emailSendsToItself: false,
  cron: "configured",
  studioSetupKey: "ok",
  studioLogin: "password",
  leadsSync: "configured",
  leadsSyncProblem: null,
};

describe("public health response", () => {
  it("contains only ok and commit", () => {
    assert.deepEqual(publicHealth(fullReport), { ok: true, commit: "76a93c7" });
  });

  it("never carries the recipient, variable names, login mode or branch", () => {
    const text = JSON.stringify(publicHealth(fullReport));
    for (const hidden of [
      "owner@example.test",
      "RESEND_API_KEY",
      "SMPT_USER",
      "password",
      "studioLogin",
      "main",
      "resend",
      "emailVariables",
    ]) {
      assert.ok(!text.includes(hidden), `${hidden} must not be public`);
    }
  });

  it("reports not ok when the app cannot accept enquiries", () => {
    assert.deepEqual(publicHealth({ ...fullReport, ok: false }), { ok: false, commit: "76a93c7" });
  });

  it("treats anything other than true as not ok, and a missing commit as null", () => {
    assert.deepEqual(
      publicHealth({ ok: "yes" as unknown as boolean, commit: undefined as unknown as null }),
      { ok: false, commit: null },
    );
  });

  it("is never cached and varies by cookie and authorization", () => {
    assert.equal(HEALTH_HEADERS["Cache-Control"], "no-store");
    assert.equal(HEALTH_HEADERS.Vary, "Cookie, Authorization");
  });

  it("accepts the full report only with the exact cron secret", () => {
    const secret = "a-long-enough-cron-secret";
    assert.equal(cronAuthorised(`Bearer ${secret}`, secret), true);
    assert.equal(cronAuthorised(`Bearer ${secret}x`, secret), false);
    assert.equal(cronAuthorised(secret, secret), false);
    assert.equal(cronAuthorised(null, secret), false);
    assert.equal(cronAuthorised("Bearer ", ""), false);
    assert.equal(
      cronAuthorised("Bearer short", "short"),
      false,
      "secrets under 16 characters never unlock it",
    );
    assert.equal(cronAuthorised("Bearer anything-at-all-here", undefined), false);
  });
});
