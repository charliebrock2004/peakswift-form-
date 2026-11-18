import { timingSafeEqual } from "node:crypto";

/**
 * What anyone on the internet may see at /api/health: whether the form can
 * accept enquiries, and which commit is live. Nothing about configuration.
 * The full diagnostic report (email set-up, Studio login mode, sync state)
 * is returned only to a signed-in Studio session, or to a caller holding
 * CRON_SECRET (so the report can still be read when the database is down
 * and no Studio session can be checked).
 */
export type PublicHealth = { ok: boolean; commit: string | null };

export function publicHealth(report: { ok: boolean; commit: string | null }): PublicHealth {
  return {
    ok: report.ok === true,
    commit: typeof report.commit === "string" ? report.commit : null,
  };
}

/** Responses differ by Studio session or cron secret: never stored, and keyed on both headers. */
export const HEALTH_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie, Authorization",
} as const;

/** Same rule as /api/notify-retry: `Authorization: Bearer <CRON_SECRET>`, secret at least 16 characters. */
export function cronAuthorised(header: string | null, secret: string | undefined): boolean {
  const value = secret?.trim();
  if (!value || value.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${value}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
