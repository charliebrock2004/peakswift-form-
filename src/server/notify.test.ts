import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../lib/db.ts";
import type { OutgoingMail, SendMail } from "./mailer.ts";
import { MAX_AUTO_ATTEMPTS, notifyBrief, retryPendingNotifications, type NotifyDeps } from "./notify.ts";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "migrations");

async function database(): Promise<{ pg: PGlite; sql: Sql }> {
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
  return { pg, sql };
}

let counter = 0;
async function submittedBrief(sql: Sql, status = "new"): Promise<string> {
  counter += 1;
  const id = crypto.randomUUID();
  const payload = {
    businessName: "Glen Gardens",
    contactName: "Sam",
    email: "sam@glengardens.co.uk",
    whatYouDo: "Landscaping",
  };
  await sql.query(
    `insert into briefs (id, reference, status, upload_token_hash, business_name, client_name, client_email, payload, submitted_at)
     values ($1, $2, $3, 'secret-token-hash', 'Glen Gardens', 'Sam', 'sam@glengardens.co.uk', $4::jsonb, now())`,
    [id, `PS-TEST${counter}`, status, JSON.stringify(payload)],
  );
  return id;
}

function recorder(fail = 0): { sent: OutgoingMail[]; send: SendMail } {
  const sent: OutgoingMail[] = [];
  let failures = fail;
  return {
    sent,
    send: async (mail) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("SMTP 454 temporary failure");
      }
      sent.push(mail);
      return { messageId: `<${sent.length}@peakswift.test>`, response: "250 2.0.0 OK 1791530000 gsmtp" };
    },
  };
}

function deps(send: SendMail | null): NotifyDeps {
  return { send, from: "PeakSwiftstudio@gmail.com", to: "PeakSwiftstudio@gmail.com", siteUrl: "https://peakswift-form.vercel.app/" };
}

async function state(sql: Sql, id: string) {
  const rows = await sql<{ status: string; notification_status: string; notification_attempts: number; notification_error: string | null }>`
    select status, notification_status, notification_attempts, notification_error from briefs where id = ${id}
  `;
  return rows[0]!;
}

test("a submitted brief is emailed once with its details and a Studio link", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  await sql.query(
    `insert into brief_files (id, brief_id, kind, filename, mime, size_bytes, data) values ($1, $2, 'logo', 'logo.png', 'image/png', 4, $3)`,
    [crypto.randomUUID(), id, new Uint8Array([1, 2, 3, 4])],
  );
  const mail = recorder();
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "sent");
  assert.equal(mail.sent.length, 1);
  const message = mail.sent[0]!;
  assert.equal(message.to, "PeakSwiftstudio@gmail.com");
  assert.equal(message.replyTo, "sam@glengardens.co.uk");
  assert.match(message.subject, /^New Website Enquiry — Glen Gardens — PS-TEST\d+$/);
  assert.match(message.text, /logo\.png/);
  assert.match(message.text, new RegExp(`https://peakswift-form\\.vercel\\.app/studio\\?brief=${id}`));
  assert.doesNotMatch(message.text + message.html, /secret-token-hash|DATABASE_URL/);
  assert.equal((await state(sql, id)).notification_status, "sent");
});

test("a retried request never sends a second email", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const mail = recorder();
  await notifyBrief(sql, id, deps(mail.send));
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "not-eligible");
  assert.equal(await notifyBrief(sql, id, deps(mail.send), { manual: true }), "not-eligible");
  assert.equal(mail.sent.length, 1);
});

test("concurrent requests for the same brief send only one email", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const mail = recorder();
  const outcomes = await Promise.all([1, 2, 3, 4].map(() => notifyBrief(sql, id, deps(mail.send))));
  assert.equal(mail.sent.length, 1);
  assert.equal(outcomes.filter((outcome) => outcome === "sent").length, 1);
});

test("a provider failure keeps the brief, records the error, and a later retry sends it", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const mail = recorder(1);
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "failed");
  const failed = await state(sql, id);
  assert.equal(failed.status, "new", "the brief stays in the inbox");
  assert.equal(failed.notification_status, "failed");
  assert.match(failed.notification_error ?? "", /temporary failure/);
  assert.deepEqual(await retryPendingNotifications(sql, deps(mail.send)), { attempted: 1, sent: 1, failed: 0 });
  assert.equal(mail.sent.length, 1);
  assert.equal((await state(sql, id)).notification_error, null);
});

test("without email configured the brief waits as pending and is sent once configured", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  assert.equal(await notifyBrief(sql, id, deps(null)), "not-configured");
  assert.equal((await state(sql, id)).notification_status, "pending");
  const mail = recorder();
  await retryPendingNotifications(sql, deps(mail.send));
  assert.equal(mail.sent.length, 1);
});

test("drafts are never emailed", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql, "draft");
  const mail = recorder();
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "not-eligible");
  assert.equal(mail.sent.length, 0);
});

test("automatic retries stop at the cap; Studio's manual retry still works", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const mail = recorder(MAX_AUTO_ATTEMPTS);
  for (let i = 0; i < MAX_AUTO_ATTEMPTS; i += 1) await notifyBrief(sql, id, deps(mail.send));
  assert.equal((await state(sql, id)).notification_attempts, MAX_AUTO_ATTEMPTS);
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "not-eligible");
  assert.deepEqual(await retryPendingNotifications(sql, deps(mail.send)), { attempted: 0, sent: 0, failed: 0 });
  assert.equal(await notifyBrief(sql, id, deps(mail.send), { manual: true }), "sent");
  assert.equal(mail.sent.length, 1);
});

test("a send abandoned mid-way is only reclaimed after it goes stale", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  await sql`update briefs set notification_status = 'sending', notification_claimed_at = now() where id = ${id}`;
  const mail = recorder();
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "not-eligible");
  await sql`update briefs set notification_claimed_at = now() - interval '11 minutes' where id = ${id}`;
  assert.equal(await notifyBrief(sql, id, deps(mail.send)), "sent");
  assert.equal(mail.sent.length, 1);
});

test("the migration does not email briefs that were already in the inbox", async () => {
  const pg = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  for (const name of files.filter((file) => file < "0004")) await pg.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  await pg.query(
    `insert into briefs (id, reference, status, payload) values ('old', 'PS-OLD', 'new', '{}'::jsonb), ('wip', 'PS-WIP', 'draft', '{}'::jsonb)`,
  );
  for (const name of files.filter((file) => file >= "0004")) await pg.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const rows = (await pg.query<{ id: string; notification_status: string }>(`select id, notification_status from briefs order by id`)).rows;
  assert.deepEqual(rows, [
    { id: "old", notification_status: "skipped" },
    { id: "wip", notification_status: "pending" },
  ]);
});

test("a sent notification keeps the mail server's reply and Message-ID as evidence", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const mail = recorder();
  const original = console.log;
  const logs: string[] = [];
  console.log = (line: string) => logs.push(line);
  try {
    assert.equal(await notifyBrief(sql, id, deps(mail.send)), "sent");
  } finally {
    console.log = original;
  }
  const rows = await sql<{ notification_message_id: string; notification_response: string; notification_sent_at: unknown }>`
    select notification_message_id, notification_response, notification_sent_at from briefs where id = ${id}
  `;
  assert.equal(rows[0]?.notification_message_id, "<1@peakswift.test>");
  assert.equal(rows[0]?.notification_response, "250 2.0.0 OK 1791530000 gsmtp");
  assert.ok(rows[0]?.notification_sent_at);
  assert.match(logs.join("\n"), /PS-TEST\d+ accepted by mail server for PeakSwiftstudio@gmail\.com: 250 2\.0\.0 OK/);
});

test("a rejected recipient is recorded as a failure, not as sent", async () => {
  const { sql } = await database();
  const id = await submittedBrief(sql);
  const original = console.error;
  console.error = () => undefined;
  try {
    const { receiptFrom } = await import("./mailer.ts");
    const send: SendMail = async (mail) =>
      receiptFrom({ response: "550 5.1.1 No such user", accepted: [], rejected: [mail.to] }, mail.to);
    assert.equal(await notifyBrief(sql, id, deps(send)), "failed");
  } finally {
    console.error = original;
  }
  const state = await sql<{ notification_status: string; notification_error: string }>`
    select notification_status, notification_error from briefs where id = ${id}
  `;
  assert.equal(state[0]?.notification_status, "failed");
  assert.match(state[0]?.notification_error ?? "", /550 5\.1\.1/);
});
