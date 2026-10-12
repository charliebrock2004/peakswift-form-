import assert from "node:assert/strict";
import test from "node:test";
import { deploymentInfo, emailStatusFrom, runTestEmail } from "./email-check.ts";
import { resolveEmailSetup } from "./email-transport.ts";

const KEY = "re_TESTKEY_1234567890";
const production = { environment: "production", branch: "main", commit: "abc1234" };

test("a test email through Resend reports acceptance and the email id", async () => {
  const setup = resolveEmailSetup({ RESEND_API_KEY: KEY }, async () =>
    new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555555555" }), { status: 200 }),
  );
  const result = await runTestEmail(setup.transport, null, new Date("2026-10-12T09:00:00Z"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider, "resend");
  assert.equal(result.messageId, "11111111-2222-3333-4444-555555555555");
  assert.equal(result.recipient, "PeakSwiftstudio@gmail.com");
  assert.equal(result.note, null);
});

test("a Gmail login rejection is reported with the fix, without the password", async () => {
  const setup = resolveEmailSetup({ SMTP_USER: "PeakSwiftstudio@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
  const transport = { ...setup.transport!, send: async () => { throw new Error("Invalid login: 535-5.7.8 Username and Password not accepted (abcdefghijklmnop)"); } };
  const result = await runTestEmail(transport, null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /535-5\.7\.8/);
  assert.match(result.error, /App Password/);
  assert.doesNotMatch(result.error, /abcdefghijklmnop/);
});

test("without configuration nothing is sent and the reason is given", async () => {
  const setup = resolveEmailSetup({});
  const result = await runTestEmail(setup.transport, setup.problem);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /RESEND_API_KEY/);
});

// Regression: the live domain answered from a Preview build (commit 2d026df, a
// PR branch) where Production-only variables are absent, so email looked
// "missing" although it was set for Production.
test("a missing provider on a Preview deployment says which environment needs the variable", () => {
  const status = emailStatusFrom(resolveEmailSetup({}), { environment: "preview", branch: "fix/email-delivery-check", commit: "2d026df" });
  assert.equal(status.configured, false);
  assert.match(status.problem ?? "", /preview deployment \(branch fix\/email-delivery-check\)/);
  assert.match(status.problem ?? "", /enabled for "Preview"/);
  const prod = emailStatusFrom(resolveEmailSetup({}), production);
  assert.doesNotMatch(prod.problem ?? "", /Preview/);
});

test("Studio's status shows addresses and deployment, never secrets", () => {
  const status = emailStatusFrom(resolveEmailSetup({ RESEND_API_KEY: KEY }), production);
  assert.equal(status.configured, true);
  assert.equal(status.provider, "resend");
  assert.doesNotMatch(JSON.stringify(status), new RegExp(KEY));
  const smtpSelf = emailStatusFrom(resolveEmailSetup({ SMTP_USER: "PeakSwiftstudio@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" }), production);
  assert.equal(smtpSelf.sendsToItself, true);
  assert.doesNotMatch(JSON.stringify(smtpSelf), /abcd|abcdefgh/);
  assert.deepEqual(deploymentInfo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: "050b2d632a" }), {
    environment: "production",
    branch: "main",
    commit: "050b2d6",
  });
});
