import assert from "node:assert/strict";
import test from "node:test";
import { credentialsMatch, DEFAULT_STUDIO_USERNAME, studioCredentials } from "./studio-credentials.ts";

test("username + password login is off until STUDIO_PASSWORD is set", () => {
  assert.equal(studioCredentials({}), null);
  assert.equal(studioCredentials({ STUDIO_USERNAME: "charliebrock" }), null);
  assert.equal(studioCredentials({ STUDIO_PASSWORD: "   " }), null);
});

test("the username defaults to charliebrock and can be overridden", () => {
  assert.deepEqual(studioCredentials({ STUDIO_PASSWORD: "s3cret-pass" }), { username: DEFAULT_STUDIO_USERNAME, password: "s3cret-pass" });
  assert.equal(DEFAULT_STUDIO_USERNAME, "charliebrock");
  assert.equal(studioCredentials({ STUDIO_PASSWORD: "x", STUDIO_USERNAME: "someone" })?.username, "someone");
});

test("only the exact password with the right username signs in", () => {
  const creds = studioCredentials({ STUDIO_PASSWORD: "Pass-From-Vercel" })!;
  assert.equal(credentialsMatch("charliebrock", "Pass-From-Vercel", creds), true);
  assert.equal(credentialsMatch("  CharlieBrock ", "Pass-From-Vercel", creds), true, "username ignores case and spaces");
  assert.equal(credentialsMatch("charliebrock", "pass-from-vercel", creds), false, "password is case-sensitive");
  assert.equal(credentialsMatch("charliebrock", "", creds), false);
  assert.equal(credentialsMatch("someone-else", "Pass-From-Vercel", creds), false);
});

test("quotes and invisible characters pasted into Vercel are ignored", () => {
  const creds = studioCredentials({ STUDIO_PASSWORD: ' "Pass-From-Vercel"\u200B ', STUDIO_USERNAME: "charliebrock\u200B" })!;
  assert.equal(credentialsMatch("charliebrock", "Pass-From-Vercel", creds), true);
});
