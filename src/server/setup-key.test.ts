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
