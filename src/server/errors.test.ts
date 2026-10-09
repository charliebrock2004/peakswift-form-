import assert from "node:assert/strict";
import test from "node:test";
import { errorResponse, HttpError } from "./errors.ts";

test("validation errors keep their status, message and fields", async () => {
  const res = errorResponse("api/brief", new HttpError(400, "Check the highlighted fields.", { email: "bad" }), "x");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Check the highlighted fields.", fields: { email: "bad" } });
});

test("a missing production database is reported as unavailable, not a generic failure", async () => {
  const error = Object.assign(new Error("DATABASE_URL is not set"), { name: "DatabaseNotConfiguredError" });
  const original = console.error;
  console.error = () => undefined;
  try {
    const res = errorResponse("api/brief", error, "We couldn’t save your enquiry.");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, "database_not_configured");
    assert.match(body.error, /PeakSwiftstudio@gmail\.com/);
    assert.doesNotMatch(body.error, /DATABASE_URL/);
  } finally {
    console.error = original;
  }
});

test("unexpected errors say nothing was saved and never leak internals", async () => {
  const original = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const res = errorResponse("api/brief", new Error('relation "briefs" does not exist'), "We couldn’t save your enquiry.");
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /couldn’t save your enquiry/);
    assert.doesNotMatch(body.error, /relation/);
    assert.equal(logged.length, 1, "the real error is logged for Vercel");
  } finally {
    console.error = original;
  }
});
