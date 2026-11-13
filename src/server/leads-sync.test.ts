import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../lib/db.ts";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../lib/integration/signing.ts";
import type { OutgoingMail, SendMail } from "./mailer.ts";
import { deliverToLeads, leadsSyncConfig, MAX_AUTO_DELIVERIES, retryLeadsDeliveries, type LeadsSyncDeps } from "./leads-sync.ts";
import { notifyBrief } from "./notify.ts";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "migrations");
const SECRET = "forms-leads-test-secret-0123456789abcdef";

async function database(): Promise<Sql> {
  const pg = new PGlite();
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  }
  const run = async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0]!;
    values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
    return run(text, values);
  }) as unknown as Sql;
  sql.query = run as Sql["query"];
  return sql;
}

let counter = 0;
async function exampleRequest(sql: Sql, options: { status?: string; kind?: string; campaign?: string } = {}): Promise<string> {
  counter += 1;
  const id = crypto.randomUUID();
  const payload = { businessName: "Glen Joinery", contactName: "Sam Reid", email: "sam@glenjoinery.co.uk", trade: "Joiner", area: "Crieff" };
  const kind = options.kind ?? "free_example";
  await sql.query(
    `insert into briefs (id, reference, status, business_name, client_name, client_email, payload, submitted_at, form_kind, campaign_ref, leads_sync_status)
     values ($1, $2, $3, 'Glen Joinery', 'Sam Reid', 'sam@glenjoinery.co.uk', $4::jsonb, now(), $5, $6, $7)`,
    [id, `PS-SYNC${counter}`, options.status ?? "new", JSON.stringify(payload), kind, options.campaign ?? "fwe_testcamp1", kind === "free_example" ? "pending" : "not_applicable"],
  );
  await sql.query(`insert into brief_files (id, brief_id, kind, filename, mime, size_bytes, data) values ($1, $2, 'work', 'kitchen.jpg', 'image/jpeg', 3, $3)`, [
    crypto.randomUUID(),
    id,
    new Uint8Array([0xff, 0xd8, 0xff]),
  ]);
  return id;
}

type Call = { url: string; headers: Record<string, string>; body: string };

function leads(responses: (number | Error)[] = [200]): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  let index = 0;
  const fake = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers as Record<string, string>, body: String(init?.body ?? "") });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ ok: next < 300, requestId: "wer_1" }), { status: next });
  }) as typeof fetch;
  return { calls, fetch: fake };
}

function deps(fetchImpl: typeof fetch): LeadsSyncDeps {
  return { url: "https://leads.example.test/api/website-examples/webhook", secrets: [SECRET], siteUrl: "https://forms.example.test", fetch: fetchImpl };
}

async function state(sql: Sql, id: string) {
  const rows = await sql<{ leads_sync_status: string; leads_sync_attempts: number; leads_sync_error: string | null }>`
    select leads_sync_status, leads_sync_attempts, leads_sync_error from briefs where id = ${id}`;
  return rows[0]!;
}

test("a submitted request is delivered once, signed, with no file bytes or contact secrets beyond the answers", async () => {
  const sql = await database();
  const id = await exampleRequest(sql);
  const server = leads();
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch)), "delivered");
  assert.equal(server.calls.length, 1);
  const call = server.calls[0]!;
  const verdict = verifySignature({
    secrets: [SECRET],
    signature: call.headers[SIGNATURE_HEADER],
    timestamp: call.headers[TIMESTAMP_HEADER],
    method: "POST",
    path: "/api/website-examples/webhook",
    body: call.body,
  });
  assert.deepEqual(verdict, { ok: true });
  assert.equal(call.headers["idempotency-key"], id);
  const payload = JSON.parse(call.body);
  assert.equal(payload.type, "free_example.submitted");
  assert.equal(payload.campaignRef, "fwe_testcamp1");
  assert.equal(payload.consent.marketing, false);
  assert.equal(payload.files.length, 1);
  assert.equal("data" in payload.files[0], false);
  assert.equal(payload.formsUrl, `https://forms.example.test/studio?brief=${id}`);
  assert.equal((await state(sql, id)).leads_sync_status, "delivered");
  // Already delivered: neither a retry nor a second finalise sends again.
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch)), "not-eligible");
  await retryLeadsDeliveries(sql, deps(server.fetch));
  assert.equal(server.calls.length, 1);
});

test("drafts and project briefs are never sent to Leads", async () => {
  const sql = await database();
  const draft = await exampleRequest(sql, { status: "draft" });
  const brief = await exampleRequest(sql, { kind: "project" });
  const server = leads();
  assert.equal(await deliverToLeads(sql, draft, deps(server.fetch)), "not-eligible");
  assert.equal(await deliverToLeads(sql, brief, deps(server.fetch)), "not-eligible");
  assert.equal(server.calls.length, 0);
});

test("a failure is recorded and retried later; a lost connection is retried too", async () => {
  const sql = await database();
  const id = await exampleRequest(sql);
  const server = leads([503, new Error("ECONNRESET"), 200]);
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch)), "failed");
  assert.match((await state(sql, id)).leads_sync_error ?? "", /503/);
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch)), "failed");
  assert.match((await state(sql, id)).leads_sync_error ?? "", /ECONNRESET/);
  const retried = await retryLeadsDeliveries(sql, deps(server.fetch));
  assert.deepEqual(retried, { attempted: 1, delivered: 1, failed: 0 });
  assert.equal((await state(sql, id)).leads_sync_status, "delivered");
});

test("automatic attempts stop at the cap; Studio's manual send still works", async () => {
  const sql = await database();
  const id = await exampleRequest(sql);
  await sql`update briefs set leads_sync_status = 'failed', leads_sync_attempts = ${MAX_AUTO_DELIVERIES} where id = ${id}`;
  const server = leads();
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch)), "not-eligible");
  assert.equal(await deliverToLeads(sql, id, deps(server.fetch), { manual: true }), "delivered");
});

test("without a Leads URL and secret nothing is sent and the request waits as not_configured", async () => {
  const sql = await database();
  const id = await exampleRequest(sql);
  assert.equal(await deliverToLeads(sql, id, { url: "", secrets: [], siteUrl: "https://forms.example.test" }), "not-configured");
  assert.equal((await state(sql, id)).leads_sync_status, "not_configured");
  assert.equal((await state(sql, id)).leads_sync_attempts, 0);
  // Once configured, the scheduled retry picks it up.
  const server = leads();
  assert.equal((await retryLeadsDeliveries(sql, deps(server.fetch))).delivered, 1);
});

test("configuration reports the missing variable by name, never a value", () => {
  assert.equal(leadsSyncConfig({}).problem, "LEADS_APP_URL is not set");
  assert.equal(leadsSyncConfig({ LEADS_APP_URL: "https://leads.example.test" }).problem, "FORMS_INTEGRATION_SECRET is not set");
  assert.equal(leadsSyncConfig({ LEADS_APP_URL: "https://leads.example.test", FORMS_INTEGRATION_SECRET: "short" }).problem, "FORMS_INTEGRATION_SECRET is shorter than 32 characters");
  assert.equal(leadsSyncConfig({ LEADS_APP_URL: "http://evil.example", FORMS_INTEGRATION_SECRET: SECRET }).problem, "LEADS_APP_URL must be an https:// address");
  const ok = leadsSyncConfig({ LEADS_APP_URL: "https://leads.example.test/", FORMS_INTEGRATION_SECRET: SECRET });
  assert.equal(ok.problem, "");
  assert.equal(ok.url, "https://leads.example.test/api/website-examples/webhook");
});

function recorder(): { sent: OutgoingMail[]; send: SendMail } {
  const sent: OutgoingMail[] = [];
  return { sent, send: async (mail) => (sent.push(mail), { messageId: "<1@test>", response: "250 OK" }) };
}

test("the Forms email steps aside once Leads has the request, and is the safety net when it does not", async () => {
  const sql = await database();
  const delivered = await exampleRequest(sql);
  await sql`update briefs set leads_sync_status = 'delivered' where id = ${delivered}`;
  const waiting = await exampleRequest(sql);
  const mail = recorder();
  const notifyDeps = { send: mail.send, from: "from@test", to: "owner@test", siteUrl: "https://forms.example.test" };
  assert.equal(await notifyBrief(sql, delivered, notifyDeps), "not-eligible");
  assert.equal(mail.sent.length, 0);
  assert.equal(await notifyBrief(sql, waiting, notifyDeps), "sent");
  assert.equal(mail.sent.length, 1);
  const email = mail.sent[0]!;
  assert.match(email.subject, /Free homepage example request — Glen Joinery/);
  assert.match(email.text, /Sam Reid/);
  assert.match(email.text, /Crieff/);
  assert.match(email.text, /fwe_testcamp1/);
  // Thin by design: the contact's address and answers stay behind the login.
  assert.doesNotMatch(email.text, /sam@glenjoinery/);
  assert.doesNotMatch(email.html, /sam@glenjoinery/);
  assert.equal(email.replyTo, undefined);
});
