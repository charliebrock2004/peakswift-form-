import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyPendingMigrations, type MigrationClient } from "./db-migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "migrations");
const realFiles = Object.fromEntries(
  readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => [`/migrations/${name}`, readFileSync(join(DIR, name), "utf8")]),
);

/** node-postgres runs multi-statement text without params; PGlite needs exec for that. */
function client(pg: PGlite): MigrationClient {
  return {
    async query(text, params) {
      if (params && params.length) return { rows: (await pg.query(text, params)).rows as Array<Record<string, unknown>> };
      const results = await pg.exec(text);
      return { rows: (results.at(-1)?.rows ?? []) as Array<Record<string, unknown>> };
    },
  };
}

// Regression: a database whose tables were never created (the build could not
// see DATABASE_URL, so db:migrate skipped) made every submission fail with
// `relation "briefs" does not exist`. The server now creates them itself.
test("an empty production database gets the full schema on first connection", async () => {
  const pg = new PGlite();
  const applied = await applyPendingMigrations(client(pg), realFiles);
  assert.deepEqual(applied, ["0002_briefs.sql", "0003_studio_attempts.sql", "0004_brief_notifications.sql", "0005_notification_receipts.sql"]);
  const columns = await pg.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name = 'briefs'",
  );
  assert.ok(columns.rows.some((row) => row.column_name === "notification_status"));
  await pg.query(
    "insert into briefs (id, reference, payload) values ('a', 'PS-A', '{}'::jsonb)",
  );
});

test("migrating again is a no-op and keeps data", async () => {
  const pg = new PGlite();
  await applyPendingMigrations(client(pg), realFiles);
  await pg.query("insert into briefs (id, reference, payload) values ('a', 'PS-A', '{}'::jsonb)");
  assert.deepEqual(await applyPendingMigrations(client(pg), realFiles), []);
  assert.equal((await pg.query("select * from briefs")).rows.length, 1);
});

test("a database migrated by the build only receives what is missing", async () => {
  const pg = new PGlite();
  const older = Object.fromEntries(Object.entries(realFiles).filter(([path]) => !/000[45]_/.test(path)));
  await applyPendingMigrations(client(pg), older);
  assert.deepEqual(await applyPendingMigrations(client(pg), realFiles), ["0004_brief_notifications.sql", "0005_notification_receipts.sql"]);
});

test("a failing migration rolls back completely and is not recorded", async () => {
  const pg = new PGlite();
  const files = { "/migrations/0001_ok.sql": "create table ok (id int);", "/migrations/0002_bad.sql": "select * from nope;" };
  await assert.rejects(applyPendingMigrations(client(pg), files));
  const tables = await pg.query("select 1 from information_schema.tables where table_name in ('ok', '_migrations')");
  assert.equal(tables.rows.length, 0);
});
