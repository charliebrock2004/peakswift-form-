import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTIFY_TO, describeMailError, receiptFrom, resolveMailConfig } from "./mailer.ts";

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
