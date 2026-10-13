#!/usr/bin/env node
/**
 * End-to-end tests against the real production build (.vercel/output), the
 * same function bundle Vercel runs. Run with `npm run test:e2e` (it builds
 * first). Uses an in-process Postgres (PGlite over the wire protocol) and
 * intercepts calls to Resend, so no real email is sent and no secrets are used.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bundle = join(root, ".vercel/output/functions/__server.func/index.mjs");
const SITE = "https://peakswift-form.vercel.app";
const RESEND_KEY = "re_E2E_" + randomBytes(12).toString("hex");
const CRON = "cron_" + randomBytes(16).toString("hex");
const PORT = 54000 + Math.floor(Math.random() * 1000);

let db;
let server;
let app;
/** Resend behaviour for the next calls: "ok" | "401" | "timeout". */
let resendMode = "ok";
const resendCalls = [];

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

before(async () => {
  assert.ok(existsSync(bundle), "Build first: npm run build (or use npm run test:e2e)");
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`,
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: "e2e0000000",
    VERCEL_PROJECT_PRODUCTION_URL: "peakswift-form.vercel.app",
    RESEND_API_KEY: RESEND_KEY,
    CRON_SECRET: CRON,
  });
  for (const name of ["SMTP_USER", "SMTP_PASSWORD", "NOTIFY_TO", "NOTIFY_FROM", "RESEND_FROM"]) delete process.env[name];

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url !== "https://api.resend.com/emails") return realFetch(input, init);
    resendCalls.push({ headers: init.headers, body: JSON.parse(init.body) });
    if (resendMode === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (resendMode === "401") {
      return new Response(JSON.stringify({ statusCode: 401, message: "API key is invalid" }), { status: 401 });
    }
    return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
  };
  app = (await import(pathToFileURL(bundle).href)).default;
});

after(async () => {
  await server?.stop();
  await db?.close();
});

async function call(path, init = {}) {
  const res = await app.fetch(new Request(SITE + path, init), { waitUntil() {} });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function brief(name) {
  return {
    businessName: name,
    contactName: "Test Person",
    email: "client@example.com",
    phone: "01764 123456",
    whatYouDo: "End-to-end test",
    services: [{ id: "s1", name: "Testing" }],
    style: "Modern",
    features: ["Contact form"],
    timescale: "Not sure",
    budget: "Not sure",
  };
}

/** Full client flow: save, upload one photo, finalise. */
async function submit(name, { withFile = false } = {}) {
  const created = await call("/api/brief", json({ brief: brief(name), confirmed: true }));
  assert.equal(created.status, 200, created.text);
  const { token, reference } = created.json;
  if (withFile) {
    const form = new FormData();
    form.set("token", token);
    form.set("kind", "logo");
    form.set("file", new File([PNG], "logo.png", { type: "image/png" }));
    const uploaded = await call("/api/brief-file", { method: "POST", body: form });
    assert.equal(uploaded.status, 200, uploaded.text);
  }
  const finalised = await call("/api/brief-finalise", json({ token }));
  return { token, reference, finalised };
}

async function row(reference) {
  const result = await db.query(
    `select id, status, notification_status, notification_attempts, notification_error, notification_message_id
     from briefs where reference = $1`,
    [reference],
  );
  return result.rows[0];
}

test("a submission is saved, emailed once with the full brief, and a retried finalise sends nothing more", async () => {
  resendMode = "ok";
  const before = resendCalls.length;
  const { token, reference, finalised } = await submit("E2E Success Ltd", { withFile: true });
  assert.equal(finalised.status, 200);
  assert.deepEqual(finalised.json, { reference });
  const saved = await row(reference);
  assert.equal(saved.status, "new");
  assert.equal(saved.notification_status, "sent");
  assert.match(saved.notification_message_id, /^[0-9a-f-]{36}$/);
  assert.equal(resendCalls.length, before + 1);
  const sent = resendCalls.at(-1);
  assert.equal(sent.headers["Idempotency-Key"], `peakswift-brief-${saved.id}`);
  assert.deepEqual(sent.body.to, ["PeakSwiftstudio@gmail.com"]);
  assert.equal(sent.body.reply_to, "client@example.com");
  assert.equal(sent.body.subject, `New Website Enquiry — E2E Success Ltd — ${reference}`);
  for (const part of [sent.body.text, sent.body.html]) {
    assert.match(part, new RegExp(reference));
    assert.match(part, /Test Person/);
    assert.match(part, /client@example\.com/);
    assert.match(part, /01764 123456/);
    assert.match(part, /End-to-end test/);
    assert.match(part, /logo\.png/);
    assert.match(part, new RegExp(`${SITE}/studio\\?brief=${saved.id}`));
  }
  const fileId = (await db.query("select id from brief_files where brief_id = $1", [saved.id])).rows[0].id;
  assert.match(sent.body.html, new RegExp(`href="${SITE}/api/studio-file/${fileId}"`), "file link points at the private Studio route");
  assert.ok(!JSON.stringify(sent.body).includes(token), "the client's upload token never appears in the email");
  assert.equal((await call(`/api/studio-file/${fileId}`)).status, 401, "the emailed file link needs a Studio login");

  const again = await call("/api/brief-finalise", json({ token }));
  assert.equal(again.status, 200);
  assert.equal(resendCalls.length, before + 1, "no duplicate email on retry");
});

test("an invalid API key fails the email but keeps the brief, and the stored error explains it without the key", async () => {
  resendMode = "401";
  const { reference, finalised } = await submit("E2E Bad Key Ltd");
  assert.equal(finalised.status, 200, "the client still gets their reference");
  const saved = await row(reference);
  assert.equal(saved.status, "new", "brief kept");
  assert.equal(saved.notification_status, "failed");
  assert.match(saved.notification_error, /HTTP 401/);
  assert.match(saved.notification_error, /resend\.com\/api-keys/);
  assert.doesNotMatch(saved.notification_error, new RegExp(RESEND_KEY));
});

test("a provider timeout fails the email but keeps the brief", async () => {
  resendMode = "timeout";
  const { reference, finalised } = await submit("E2E Timeout Ltd");
  assert.equal(finalised.status, 200);
  const saved = await row(reference);
  assert.equal(saved.status, "new");
  assert.equal(saved.notification_status, "failed");
  assert.match(saved.notification_error, /timeout/i);
});

test("without email configuration the brief is saved and waits as pending", async () => {
  delete process.env.RESEND_API_KEY;
  try {
    const { reference, finalised } = await submit("E2E No Config Ltd");
    assert.equal(finalised.status, 200);
    assert.equal((await row(reference)).notification_status, "pending");
    const health = await call("/api/health");
    assert.equal(health.json.email, "not-configured");
    assert.match(health.json.emailProblem, /RESEND_API_KEY/);
  } finally {
    process.env.RESEND_API_KEY = RESEND_KEY;
  }
});

test("the retry job needs the cron secret, then sends each waiting email exactly once", async () => {
  assert.equal((await call("/api/notify-retry")).status, 401);
  assert.equal((await call("/api/notify-retry", { headers: { authorization: "Bearer wrong" } })).status, 401);
  resendMode = "ok";
  const before = resendCalls.length;
  const first = await call("/api/notify-retry", { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { attempted: 3, sent: 3, failed: 0 });
  assert.equal(resendCalls.length, before + 3);
  for (const name of ["E2E Bad Key Ltd", "E2E Timeout Ltd", "E2E No Config Ltd"]) {
    const result = await db.query("select notification_status from briefs where business_name = $1", [name]);
    assert.equal(result.rows[0].notification_status, "sent", name);
  }
  const second = await call("/api/notify-retry", { headers: { authorization: `Bearer ${CRON}` } });
  assert.deepEqual(second.json, { attempted: 0, sent: 0, failed: 0 });
  assert.equal(resendCalls.length, before + 3, "nothing sent twice");
});

test("uploaded files are private: Studio session required, never public", async () => {
  const file = (await db.query("select id from brief_files limit 1")).rows[0];
  assert.ok(file);
  assert.equal((await call(`/api/studio-file/${file.id}`)).status, 401);
  assert.equal((await call(`/api/studio-file/${file.id}`, { headers: { cookie: "ps_studio=forged" } })).status, 401);
  const token = randomBytes(32).toString("base64url");
  await db.query("insert into studio_sessions (token_hash, expires_at) values ($1, now() + interval '1 hour')", [
    createHash("sha256").update(token).digest("hex"),
  ]);
  const ok = await call(`/api/studio-file/${file.id}`, { headers: { cookie: `ps_studio=${token}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
});

test("files cannot be added to a brief after it is submitted", async () => {
  resendMode = "ok";
  const { token } = await submit("E2E Late Upload Ltd");
  const form = new FormData();
  form.set("token", token);
  form.set("kind", "logo");
  form.set("file", new File([PNG], "late.png", { type: "image/png" }));
  const late = await call("/api/brief-file", { method: "POST", body: form });
  assert.equal(late.status, 400);
});

test("health reports state without exposing any secret", async () => {
  const health = await call("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.email, "configured");
  assert.equal(health.json.emailProvider, "resend");
  assert.equal(health.json.environment, "production");
  assert.equal(health.json.branch, "main");
  for (const secret of [RESEND_KEY, CRON, process.env.DATABASE_URL]) assert.ok(!health.text.includes(secret));
});
