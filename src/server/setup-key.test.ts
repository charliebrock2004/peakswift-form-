import assert from "node:assert/strict";
import test from "node:test";
import { resolveSetupKey } from "./setup-key.ts";

test("local preview keeps the existing setup key when none is configured", () => {
  assert.equal(resolveSetupKey({}), "PEAKSWIFT");
});

test("vercel refuses the built-in setup key", () => {
  assert.equal(resolveSetupKey({ VERCEL: "1" }), null);
  assert.equal(resolveSetupKey({ VERCEL_ENV: "production" }), null);
});

test("an explicit setup key overrides the local fallback", () => {
  assert.equal(resolveSetupKey({ STUDIO_SETUP_KEY: "warehouse-key" }), "warehouse-key");
  assert.equal(resolveSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: "warehouse-key" }), "warehouse-key");
});

test("a short configured setup key is rejected", () => {
  assert.equal(resolveSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: "short" }), null);
});

// Regression: the live Studio said only "Studio setup is not configured on this
// server." for every cause. Each cause is now named, with the deployment it
// applies to, and the value is never included.
test("a missing key on Vercel names the variable, the environment and the fix", async () => {
  const { diagnoseSetupKey } = await import("./setup-key.ts");
  const result = diagnoseSetupKey({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/email-resend" });
  assert.equal(result.key, null);
  assert.equal(result.state, "missing");
  assert.match(result.problem ?? "", /STUDIO_SETUP_KEY is not set in this preview deployment \(branch fix\/email-resend\)/);
  assert.match(result.problem ?? "", /Production and Preview/);
  const production = diagnoseSetupKey({ VERCEL: "1", VERCEL_ENV: "production" });
  assert.match(production.problem ?? "", /this production deployment/);
});

test("a blank or whitespace-only key counts as missing", async () => {
  const { diagnoseSetupKey } = await import("./setup-key.ts");
  assert.equal(diagnoseSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: "   " }).state, "missing");
  assert.equal(diagnoseSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: '""' }).state, "missing");
});

test("too short and too long keys say so without revealing the value", async () => {
  const { diagnoseSetupKey } = await import("./setup-key.ts");
  const short = diagnoseSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: "abc123" });
  assert.equal(short.state, "too-short");
  assert.match(short.problem ?? "", /shorter than 8 characters/);
  assert.doesNotMatch(short.problem ?? "", /abc123/);
  const long = diagnoseSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: "x".repeat(201) });
  assert.equal(long.state, "too-long");
});

test("quotes and invisible characters from copy-paste are ignored", async () => {
  const { diagnoseSetupKey, normaliseSetupKey } = await import("./setup-key.ts");
  assert.equal(diagnoseSetupKey({ VERCEL: "1", STUDIO_SETUP_KEY: ' "my-private-key"\u200B ' }).key, "my-private-key");
  assert.equal(normaliseSetupKey("  my-private-key\u200B\n"), "my-private-key");
});
