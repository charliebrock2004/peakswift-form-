import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTIFY_TO, describeMailError, diagnoseMailConfig, receiptFrom, resolveMailConfig } from "./mailer.ts";

test("email is off until both SMTP_USER and SMTP_PASSWORD are set", () => {
  assert.equal(resolveMailConfig({}), null);
  assert.equal(resolveMailConfig({ SMTP_USER: "PeakSwiftstudio@gmail.com" }), null);
  assert.equal(resolveMailConfig({ SMTP_PASSWORD: "abcd efgh ijkl mnop" }), null);
});

test("Gmail defaults: port 465 TLS, sender is the account, recipient is PeakSwift", () => {
  const config = resolveMailConfig({ SMTP_USER: "PeakSwiftstudio@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
  assert.ok(config);
  assert.equal(config.host, "smtp.gmail.com");
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.password, "abcdefghijklmnop", "spaces Google shows in App Passwords are removed");
  assert.equal(config.from, "PeakSwiftstudio@gmail.com");
  assert.equal(config.to, DEFAULT_NOTIFY_TO);
  assert.equal(DEFAULT_NOTIFY_TO, "PeakSwiftstudio@gmail.com");
});

test("another SMTP provider can be used with an explicit sender", () => {
  const config = resolveMailConfig({
    SMTP_HOST: "smtp.resend.com",
    SMTP_PORT: "587",
    SMTP_USER: "resend",
    SMTP_PASSWORD: "re_123",
    NOTIFY_FROM: "studio@peakswift.co.uk",
  });
  assert.ok(config);
  assert.equal(config.secure, false);
  assert.equal(config.from, "studio@peakswift.co.uk");
  // A non-email SMTP user with no NOTIFY_FROM has no valid sender.
  assert.equal(resolveMailConfig({ SMTP_HOST: "smtp.resend.com", SMTP_USER: "resend", SMTP_PASSWORD: "x" }), null);
});

test("recipient override must be a single address", () => {
  const base = { SMTP_USER: "a@gmail.com", SMTP_PASSWORD: "pw" };
  assert.equal(resolveMailConfig({ ...base, NOTIFY_TO: "a@b.com, c@d.com" }), null);
  assert.equal(resolveMailConfig({ ...base, NOTIFY_TO: "other@example.com" })?.to, "other@example.com");
});

test("stored error text never contains the password", () => {
  const message = describeMailError(new Error("Invalid login: secretpw rejected"), { user: "a", password: "secretpw" });
  assert.doesNotMatch(message, /secretpw/);
  assert.match(message, /\[redacted\]/);
});

test("a receipt is only produced when the recipient was accepted", () => {
  const to = "PeakSwiftstudio@gmail.com";
  const ok = receiptFrom({ messageId: "<abc@x>", response: "250 2.0.0 OK  1791 gsmtp", accepted: ["peakswiftstudio@gmail.com"], rejected: [] }, to);
  assert.deepEqual(ok, { messageId: "<abc@x>", response: "250 2.0.0 OK 1791 gsmtp" });
  assert.throws(() => receiptFrom({ response: "550 no such user", accepted: [], rejected: [to] }, to), /550 no such user/);
  assert.throws(() => receiptFrom({ response: "250 ok", accepted: ["someone@else.com"], rejected: [] }, to), /not accepted/);
});

// Regression: production health reported email "not-configured" with SMTP_USER,
// SMTP_PASSWORD and CRON_SECRET set, and no way to tell which check failed.
// Harmless formatting is now accepted and every remaining failure is named.
const APP_PASSWORD = "abcd efgh ijkl mnop";

test("common ways of entering the Gmail address are accepted", () => {
  for (const user of [
    "PeakSwiftstudio@gmail.com",
    "  PeakSwiftstudio@gmail.com\n",
    '"PeakSwiftstudio@gmail.com"',
    "PeakSwift <PeakSwiftstudio@gmail.com>",
    "PeakSwiftstudio@gmail.com\u200B",
    "PeakSwiftstudio",
  ]) {
    const config = resolveMailConfig({ SMTP_USER: user, SMTP_PASSWORD: APP_PASSWORD });
    assert.ok(config, `should accept ${JSON.stringify(user)}`);
    assert.equal(config.user, "PeakSwiftstudio@gmail.com");
    assert.equal(config.from, "PeakSwiftstudio@gmail.com");
    assert.equal(config.password, "abcdefghijklmnop");
    assert.equal(config.to, "PeakSwiftstudio@gmail.com");
  }
});

test("common alternative variable names work", () => {
  assert.ok(resolveMailConfig({ SMTP_USERNAME: "a@gmail.com", SMTP_PASS: APP_PASSWORD }));
  assert.ok(resolveMailConfig({ GMAIL_USER: "a@gmail.com", GMAIL_APP_PASSWORD: APP_PASSWORD }));
  // The documented names win when both are present.
  assert.equal(resolveMailConfig({ SMTP_USER: "a@gmail.com", GMAIL_USER: "b@gmail.com", SMTP_PASSWORD: "x" })?.user, "a@gmail.com");
});

test("every way email can be off is explained by variable name", () => {
  const cases: Array<[NodeJS.ProcessEnv, RegExp]> = [
    [{}, /SMTP_USER is missing/],
    [{ SMTP_USER: "   " , SMTP_PASSWORD: APP_PASSWORD }, /SMTP_USER is missing or blank/],
    [{ SMTP_USER: "a@gmail.com" }, /SMTP_PASSWORD is missing/],
    [{ SMTP_USER: "a@gmail.com", SMTP_PASSWORD: APP_PASSWORD, SMTP_PORT: "smtp.gmail.com" }, /SMTP_PORT/],
    [{ SMTP_USER: "a@gmail.com", SMTP_PASSWORD: APP_PASSWORD, NOTIFY_TO: "PeakSwift" }, /NOTIFY_TO/],
    [{ SMTP_USER: "a@gmail.com", SMTP_PASSWORD: APP_PASSWORD, NOTIFY_FROM: "nope" }, /NOTIFY_FROM/],
  ];
  for (const [env, expected] of cases) {
    const result = diagnoseMailConfig(env);
    assert.equal(result.config, null);
    assert.match(result.problem ?? "", expected);
  }
  assert.equal(diagnoseMailConfig({ SMTP_USER: "a@gmail.com", SMTP_PASSWORD: APP_PASSWORD }).problem, null);
});

test("the diagnosis reports which names are present but never their values", () => {
  const env = { SMTP_USER: "secret.user@gmail.com", SMTP_PASSWORD: "zzzz yyyy xxxx wwww", NOTIFY_TO: "" };
  const result = diagnoseMailConfig(env);
  assert.equal(result.variables.SMTP_USER, "set");
  assert.equal(result.variables.SMTP_PASSWORD, "set");
  assert.equal(result.variables.NOTIFY_TO, "blank");
  assert.equal(result.variables.GMAIL_USER, "missing");
  const reported = JSON.stringify({ problem: result.problem, variables: result.variables });
  assert.doesNotMatch(reported, /secret\.user|zzzz|yyyy/);
  const failing = JSON.stringify(diagnoseMailConfig({ ...env, SMTP_PORT: "oops" }));
  assert.doesNotMatch(failing.replace(/"config":\{[^}]*\}/, ""), /zzzz|secret\.user/);
});
