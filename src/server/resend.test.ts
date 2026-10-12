import assert from "node:assert/strict";
import test from "node:test";
import { createResendSender, RESEND_ENDPOINT } from "./resend.ts";

const KEY = "re_TESTKEY_1234567890";
const mail = {
  to: "PeakSwiftstudio@gmail.com",
  from: "PeakSwift Enquiries <onboarding@resend.dev>",
  replyTo: "client@example.com",
  idempotencyKey: "peakswift-brief-abc",
  subject: "New Website Enquiry — Test — PS-TEST01",
  text: "plain",
  html: "<p>html</p>",
};

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("a send posts the full message once and returns Resend's email id as the receipt", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const send = createResendSender(KEY, async (url, init) => {
    calls.push({ url, init });
    return reply(200, { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
  });
  const receipt = await send(mail);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, RESEND_ENDPOINT);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.equal(headers["Idempotency-Key"], "peakswift-brief-abc");
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(body.to, ["PeakSwiftstudio@gmail.com"]);
  assert.equal(body.reply_to, "client@example.com");
  assert.equal(body.subject, mail.subject);
  assert.equal(receipt.messageId, "4ef9a417-02e9-4d39-ad75-9611e0fcc33c");
  assert.match(receipt.response, /Accepted by Resend \(HTTP 200\)/);
});

test("an invalid API key is a failure with Resend's reason", async () => {
  const send = createResendSender(KEY, async () => reply(401, { statusCode: 401, name: "validation_error", message: "API key is invalid" }));
  await assert.rejects(send(mail), /Resend rejected the email \(HTTP 401\): API key is invalid/);
});

test("a provider rejection (unverified sender / wrong account) is a failure", async () => {
  const send = createResendSender(KEY, async () =>
    reply(403, { message: "You can only send testing emails to your own email address (someone@else.com)." }),
  );
  await assert.rejects(send(mail), /HTTP 403.*own email address/);
  const invalid = createResendSender(KEY, async () => reply(422, { message: "Invalid `from` field." }));
  await assert.rejects(invalid(mail), /HTTP 422/);
});

test("a timeout or network failure is a failure, never a success", async () => {
  const timeout = createResendSender(KEY, async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  });
  await assert.rejects(timeout(mail), /did not respond within 15 seconds \(timeout\)/);
  const offline = createResendSender(KEY, async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(offline(mail), /Could not reach Resend: fetch failed/);
});

test("a 200 without an email id is not treated as accepted", async () => {
  const send = createResendSender(KEY, async () => reply(200, "not json"));
  await assert.rejects(send(mail), /without an email id/);
});
