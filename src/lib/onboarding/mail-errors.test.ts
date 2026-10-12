import assert from "node:assert/strict";
import test from "node:test";
import { explainMailError } from "./mail-errors.ts";

test("Gmail's real rejections are explained in plain language", () => {
  const cases: Array<[string, RegExp]> = [
    ["Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to 535 5.7.8 https://support.google.com/mail/?p=BadCredentials", /App Password/],
    ["Invalid login: 534-5.7.9 Application-specific password required.", /2-Step Verification/],
    ["Message failed: 550-5.4.5 Daily user sending limit exceeded.", /daily sending limit/],
    ["Recipient not accepted by the mail server: 550 5.1.1 The email account that you tried to reach does not exist.", /NOTIFY_TO/],
    ["connect ETIMEDOUT 142.250.27.108:465", /could not be reached/],
    ["Greeting never received", /could not be reached/],
    ["Timeout", /could not be reached/],
    ["Message failed: 421 4.7.0 Try again later", /temporary/],
  ];
  for (const [message, expected] of cases) assert.match(explainMailError(message) ?? "", expected, message);
  assert.equal(explainMailError("something unexpected"), null);
});
