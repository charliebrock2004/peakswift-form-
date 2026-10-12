import assert from "node:assert/strict";
import test from "node:test";
import { emailStatusFrom, runTestEmail } from "./email-check.ts";
import { describeMailError, diagnoseMailConfig, type MailConfig, type SendMail } from "./mailer.ts";

const PASSWORD = "abcd efgh ijkl mnop";
const selfConfig = diagnoseMailConfig({ SMTP_USER: "PeakSwiftstudio@gmail.com", SMTP_PASSWORD: PASSWORD }).config as MailConfig;

test("a test email reports the mail server's acceptance and the Message-ID", async () => {
  let sentTo = "";
  const send: SendMail = async (mail) => {
    sentTo = mail.to;
    return { messageId: "<t1@gmail.com>", response: "250 2.0.0 OK 1791 gsmtp" };
  };
  const result = await runTestEmail(selfConfig, null, send, String, new Date("2026-10-12T09:00:00Z"));
  assert.equal(sentTo, "PeakSwiftstudio@gmail.com");
  assert.deepEqual(result, {
    ok: true,
    response: "250 2.0.0 OK 1791 gsmtp",
    messageId: "<t1@gmail.com>",
    sender: "PeakSwiftstudio@gmail.com",
    recipient: "PeakSwiftstudio@gmail.com",
    note: result.ok ? result.note : null,
  });
  assert.ok(result.ok && /Sent Mail/.test(result.note ?? ""), "self-send is flagged");
});

test("a Gmail login rejection is reported with the fix, without the password", async () => {
  const send: SendMail = async () => {
    throw new Error(`Invalid login: 535-5.7.8 Username and Password not accepted (pass ${selfConfig.password})`);
  };
  const result = await runTestEmail(selfConfig, null, send, (error) => describeMailError(error, selfConfig));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /535-5\.7\.8/);
  assert.match(result.error, /App Password/);
  assert.doesNotMatch(result.error, new RegExp(selfConfig.password));
});

test("without configuration nothing is sent and the reason is given", async () => {
  const diagnosis = diagnoseMailConfig({ SMTP_USER: "PeakSwiftstudio@gmail.com" });
  let called = false;
  const result = await runTestEmail(diagnosis.config, diagnosis.problem, async () => {
    called = true;
    return { messageId: "", response: "" };
  }, String);
  assert.equal(called, false);
  assert.deepEqual(result, { ok: false, error: "SMTP_PASSWORD is missing or blank in this deployment's environment." });
});

test("Studio's status shows addresses and the self-send warning, never the password", () => {
  const status = emailStatusFrom(diagnoseMailConfig({ SMTP_USER: "PeakSwiftstudio@gmail.com", SMTP_PASSWORD: PASSWORD }));
  assert.equal(status.configured, true);
  assert.equal(status.sendsToItself, true);
  assert.doesNotMatch(JSON.stringify(status), /abcd|efgh|abcdefgh/);
  const separate = emailStatusFrom(diagnoseMailConfig({ SMTP_USER: "alerts.peakswift@gmail.com", SMTP_PASSWORD: PASSWORD }));
  assert.equal(separate.sendsToItself, false);
  assert.equal(separate.recipient, "PeakSwiftstudio@gmail.com");
  assert.equal(separate.note, null);
});
