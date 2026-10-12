import assert from "node:assert/strict";
import test from "node:test";
import { resolveEmailSetup } from "./email-transport.ts";

const KEY = "re_TESTKEY_1234567890";

test("Resend is used when RESEND_API_KEY is set, sending to PeakSwift from onboarding@resend.dev", () => {
  const setup = resolveEmailSetup({ RESEND_API_KEY: KEY });
  assert.equal(setup.provider, "resend");
  assert.equal(setup.problem, null);
  assert.equal(setup.transport?.to, "PeakSwiftstudio@gmail.com");
  assert.equal(setup.transport?.from, "PeakSwift Enquiries <onboarding@resend.dev>");
  assert.equal(setup.transport?.sendsToItself, false);
});

test("Resend takes priority over SMTP; SMTP still works on its own", () => {
  const both = resolveEmailSetup({ RESEND_API_KEY: KEY, SMTP_USER: "a@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
  assert.equal(both.provider, "resend");
  const smtp = resolveEmailSetup({ SMTP_USER: "a@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
  assert.equal(smtp.provider, "smtp");
  assert.ok(smtp.transport);
});

test("missing configuration names the variables to set", () => {
  const none = resolveEmailSetup({});
  assert.equal(none.transport, null);
  assert.match(none.problem ?? "", /RESEND_API_KEY.*SMTP_USER \+ SMTP_PASSWORD/);
  const partial = resolveEmailSetup({ SMTP_USER: "a@gmail.com" });
  assert.match(partial.problem ?? "", /SMTP_PASSWORD is missing/);
});

test("malformed Resend settings are explained, never echoed", () => {
  const badKey = resolveEmailSetup({ RESEND_API_KEY: "sk_live_wrongprovider" });
  assert.equal(badKey.transport, null);
  assert.match(badKey.problem ?? "", /start with re_/);
  assert.doesNotMatch(JSON.stringify(badKey), /sk_live_wrongprovider/);
  const badFrom = resolveEmailSetup({ RESEND_API_KEY: KEY, RESEND_FROM: "PeakSwift" });
  assert.match(badFrom.problem ?? "", /RESEND_FROM/);
  assert.doesNotMatch(JSON.stringify({ p: badFrom.problem, v: badFrom.variables }), new RegExp(KEY));
});

test("quotes and invisible characters around the key are tolerated", () => {
  assert.equal(resolveEmailSetup({ RESEND_API_KEY: ` "${KEY}"\u200B ` }).provider, "resend");
  assert.ok(resolveEmailSetup({ RESEND_API_KEY: ` "${KEY}"\u200B ` }).transport);
});

test("Resend failures stored for Studio never contain the API key and explain the fix", async () => {
  const setup = resolveEmailSetup({ RESEND_API_KEY: KEY }, async () =>
    new Response(JSON.stringify({ message: `API key is invalid (${KEY})` }), { status: 401 }),
  );
  const transport = setup.transport!;
  const error = await transport
    .send({ to: transport.to, from: transport.from, subject: "s", text: "t", html: "h" })
    .catch((e: unknown) => e);
  const stored = transport.describeError(error);
  assert.doesNotMatch(stored, new RegExp(KEY));
  assert.match(stored, /HTTP 401/);
  assert.match(stored, /resend\.com\/api-keys/);
});
