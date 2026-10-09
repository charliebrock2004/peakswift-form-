import type { Sql } from "@/lib/db";
import { mergeBrief, type FileKind } from "../lib/onboarding/model.ts";
import { renderNotificationEmail } from "../lib/onboarding/notification-email.ts";
import { isPlainEmail, type SendMail } from "./mailer.ts";

/** Automatic attempts per brief. Studio's "Retry email" ignores this cap. */
export const MAX_AUTO_ATTEMPTS = 5;
/** A claim older than this is treated as abandoned (the request died mid-send). */
export const STALE_CLAIM_MINUTES = 10;

export type NotifyOutcome = "sent" | "failed" | "not-configured" | "not-eligible";

export type NotifyDeps = {
  send: SendMail | null;
  from: string;
  to: string;
  /** Base URL of the site, e.g. https://peakswift-form.vercel.app */
  siteUrl: string;
  describeError?: (error: unknown) => string;
};

type ClaimedRow = {
  id: string;
  reference: string;
  payload: unknown;
  submitted_at: string | Date | null;
};

function toDate(value: string | Date | null): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value) : new Date();
}

/**
 * Sends the notification for one submitted brief at most once.
 *
 * The brief is already saved before this runs. An atomic claim
 * (pending/failed -> sending) means concurrent or retried requests cannot both
 * send. Failures are recorded and never thrown, so the client's submission
 * stays successful.
 */
export async function notifyBrief(
  sql: Sql,
  briefId: string,
  deps: NotifyDeps,
  options: { manual?: boolean } = {},
): Promise<NotifyOutcome> {
  if (!deps.send) return "not-configured";
  const claimed = await sql.query<ClaimedRow>(
    `update briefs
     set notification_status = 'sending',
         notification_claimed_at = now(),
         notification_attempts = notification_attempts + 1
     where id = $1
       and status in ('new', 'reviewed')
       and ($2::boolean or notification_attempts < $3)
       and (
         notification_status in ('pending', 'failed')
         or (notification_status = 'sending' and notification_claimed_at < now() - ($4::int * interval '1 minute'))
       )
     returning id, reference, payload, submitted_at`,
    [briefId, options.manual === true, MAX_AUTO_ATTEMPTS, STALE_CLAIM_MINUTES],
  );
  const row = claimed[0];
  if (!row) return "not-eligible";

  try {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const brief = mergeBrief(payload);
    const files = await sql<{ kind: FileKind; filename: string; size_bytes: number }>`
      select kind, filename, size_bytes from brief_files where brief_id = ${row.id} order by created_at asc
    `;
    const studioUrl = `${deps.siteUrl.replace(/\/+$/, "")}/studio?brief=${encodeURIComponent(row.id)}`;
    const email = renderNotificationEmail({
      brief,
      reference: row.reference,
      submittedAt: toDate(row.submitted_at),
      files: files.map((file) => ({ kind: file.kind, filename: file.filename, sizeBytes: Number(file.size_bytes) })),
      studioUrl,
    });
    await deps.send({
      to: deps.to,
      from: deps.from,
      replyTo: isPlainEmail(brief.email) ? brief.email : undefined,
      ...email,
    });
  } catch (error) {
    const message = deps.describeError ? deps.describeError(error) : String(error).slice(0, 300);
    console.error(`[notify] email for ${row.reference} failed: ${message}`);
    await sql`
      update briefs set notification_status = 'failed', notification_error = ${message}
      where id = ${row.id} and notification_status = 'sending'
    `;
    return "failed";
  }

  await sql`
    update briefs
    set notification_status = 'sent', notification_sent_at = now(), notification_error = null
    where id = ${row.id} and notification_status = 'sending'
  `;
  return "sent";
}

/** Retries briefs whose email has not gone out yet. Used by the scheduled job. */
export async function retryPendingNotifications(
  sql: Sql,
  deps: NotifyDeps,
  limit = 10,
): Promise<{ attempted: number; sent: number; failed: number }> {
  const result = { attempted: 0, sent: 0, failed: 0 };
  if (!deps.send) return result;
  const rows = await sql.query<{ id: string }>(
    `select id from briefs
     where status in ('new', 'reviewed')
       and notification_attempts < $1
       and (
         notification_status in ('pending', 'failed')
         or (notification_status = 'sending' and notification_claimed_at < now() - ($2::int * interval '1 minute'))
       )
     order by submitted_at asc
     limit $3`,
    [MAX_AUTO_ATTEMPTS, STALE_CLAIM_MINUTES, limit],
  );
  for (const row of rows) {
    const outcome = await notifyBrief(sql, row.id, deps);
    if (outcome === "not-eligible") continue;
    result.attempted += 1;
    if (outcome === "sent") result.sent += 1;
    if (outcome === "failed") result.failed += 1;
  }
  return result;
}
