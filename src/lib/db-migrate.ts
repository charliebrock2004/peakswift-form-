import { pendingMigrations } from "../../scripts/migration-plan.mjs";

/**
 * Advisory lock shared with scripts/migrate.mjs so the build-time migrator and
 * a cold-starting server never apply the same file at once.
 */
export const MIGRATION_LOCK_KEY = 48_231_907;

/** The slice of a node-postgres client this needs (also satisfied by a PGlite shim in tests). */
export type MigrationClient = {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Applies any `migrations/*.sql` the database has not recorded yet, inside one
 * transaction under an advisory lock. Returns the names applied.
 *
 * The build normally does this (`npm run build` → `db:migrate`), but only when
 * DATABASE_URL is visible to the build. Running it on first connection too
 * means production can never serve requests against a database with no tables.
 */
export async function applyPendingMigrations(client: MigrationClient, files: Record<string, string>): Promise<string[]> {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = (await client.query("select name from _migrations")).rows.map((row) => String(row.name));
    const applied: string[] = [];
    for (const { name, path } of pendingMigrations(Object.keys(files), done)) {
      await client.query(files[path]!);
      await client.query("insert into _migrations (name) values ($1)", [name]);
      applied.push(name);
    }
    await client.query("commit");
    return applied;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}
