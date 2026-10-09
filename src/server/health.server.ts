import { getSql } from "@/lib/db";
import { diagnoseMailConfig, type MailEnvState } from "@/server/mailer";

export type HealthReport = {
  ok: boolean;
  commit: string | null;
  database: "connected" | "not-configured" | "error";
  databaseError: string | null;
  schema: "ready" | "missing" | "unknown";
  email: "configured" | "not-configured";
  /** Why email is off, naming the variable involved. Never contains values. */
  emailProblem: string | null;
  /** Which recognised email variable names this deployment can see. */
  emailVariables: Record<string, MailEnvState>;
  /** Where notifications go. Not a secret; shown so a wrong NOTIFY_TO is obvious. */
  emailRecipient: string | null;
  /**
   * True when the SMTP account sends to itself. Gmail files such messages under
   * Sent Mail rather than the inbox, so they are easy to miss.
   */
  emailSendsToItself: boolean | null;
  cron: "configured" | "not-configured" | "secret-too-short";
};

/** Short, non-sensitive error code (e.g. ECONNREFUSED, 28P01, 42P01). Never the message: it can contain hosts. */
function errorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return /^[A-Z0-9_]{2,40}$/i.test(code) ? code : "unknown";
}

/**
 * Configuration status for diagnosing production without log access. Reports
 * states only; no values, connection strings, hosts or error messages.
 */
export async function healthReport(): Promise<HealthReport> {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const diagnosis = diagnoseMailConfig();
  const mail = diagnosis.config;
  const report: HealthReport = {
    ok: false,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    database: "error",
    databaseError: null,
    schema: "unknown",
    email: mail ? "configured" : "not-configured",
    emailProblem: diagnosis.problem,
    emailVariables: diagnosis.variables,
    emailRecipient: mail?.to ?? null,
    emailSendsToItself: mail ? mail.user.toLowerCase() === mail.to.toLowerCase() : null,
    cron: !secret ? "not-configured" : secret.length < 16 ? "secret-too-short" : "configured",
  };
  try {
    const sql = await getSql();
    const rows = await sql<{ ready: boolean }>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'briefs' and column_name = 'notification_status'
      ) as ready
    `;
    report.database = "connected";
    report.schema = rows[0]?.ready ? "ready" : "missing";
  } catch (error) {
    if (error instanceof Error && error.name === "DatabaseNotConfiguredError") report.database = "not-configured";
    else report.databaseError = errorCode(error);
  }
  report.ok = report.database === "connected" && report.schema === "ready";
  return report;
}
