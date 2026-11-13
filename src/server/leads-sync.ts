/**
 * Delivering free website example requests to PeakSwift Leads.
 *
 * Forms is the source of truth: the request and its files stay here. Leads
 * receives a signed copy of the answers plus a reference to each file, so it
 * can open the sales opportunity and show the request; it fetches an image
 * back through a signed request only when the owner opens it.
 *
 * Shape of the guarantees, the same as notifications:
 * - the request is saved before any delivery is attempted;
 * - an atomic claim (pending/failed/not_configured -> sending) means two
 *   concurrent finalises or retries never both deliver;
 * - every POST carries `Idempotency-Key: <brief id>` and Leads stores the
 *   Forms id under a unique index, so even a delivery Leads accepted but whose
 *   answer was lost is applied exactly once;
 * - a failure is recorded, never thrown — the visitor's submission succeeds.
 */
import type { Sql } from "@/lib/db";
import { FORM_KIND, mergeExampleRequest, PRIVACY_NOTICE_VERSION } from "../lib/onboarding/example-model.ts";
import { IDEMPOTENCY_HEADER, secretList, signedHeaders } from "../lib/integration/signing.ts";

/** Automatic attempts per request. Studio's "Send to PeakSwift Leads" ignores this cap. */
export const MAX_AUTO_DELIVERIES = 8;
export const STALE_DELIVERY_MINUTES = 10;
export const WEBHOOK_PATH = "/api/website-examples/webhook";
export const EVENT_TYPE = "free_example.submitted";

export type LeadsSyncOutcome = "delivered" | "failed" | "not-configured" | "not-eligible";

export type LeadsSyncDeps = {
  /** Full webhook URL, or "" when this deployment is not connected to Leads. */
  url: string;
  secrets: string[];
  /** Base URL of this Forms deployment, for links back to Studio. */
  siteUrl: string;
  fetch?: typeof fetch;
  /** Optional Vercel deployment-protection bypass for a protected Leads preview. */
  bypass?: string;
  now?: () => number;
};

type Env = Record<string, string | undefined>;

/** Where Leads is and how to sign for it. Reports states, never values. */
export function leadsSyncConfig(env: Env = process.env): { url: string; secrets: string[]; bypass: string; problem: string } {
  const explicit = (env.LEADS_WEBHOOK_URL ?? "").trim();
  const base = (env.LEADS_APP_URL ?? "").trim().replace(/\/+$/, "");
  const url = explicit || (base ? `${base}${WEBHOOK_PATH}` : "");
  const secrets = secretList(env.FORMS_INTEGRATION_SECRET);
  const bypass = (env.LEADS_VERCEL_BYPASS_SECRET ?? "").trim();
  let problem = "";
  if (!url) problem = "LEADS_APP_URL is not set";
  else if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) problem = "LEADS_APP_URL must be an https:// address";
  else if (!secrets.length) problem = (env.FORMS_INTEGRATION_SECRET ?? "").trim() ? "FORMS_INTEGRATION_SECRET is shorter than 32 characters" : "FORMS_INTEGRATION_SECRET is not set";
  return { url: problem ? "" : url, secrets: problem ? [] : secrets, bypass, problem };
}

type Row = {
  id: string;
  reference: string;
  payload: unknown;
  campaign_ref: string;
  submitted_at: string | Date | null;
};

function iso(value: string | Date | null): string {
  if (!value) return new Date().toISOString();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** What Leads is sent. No file bytes, no upload token, no internal Forms state. */
export function deliveryPayload(
  row: Row,
  files: { id: string; kind: string; filename: string; mime: string; size_bytes: number }[],
  siteUrl: string,
) {
  const request = mergeExampleRequest(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload);
  const base = siteUrl.replace(/\/+$/, "");
  return {
    type: EVENT_TYPE,
    version: 1,
    id: row.id,
    reference: row.reference,
    submittedAt: iso(row.submitted_at),
    campaignRef: row.campaign_ref || "",
    request,
    consent: {
      purpose: "prepare and discuss a free homepage example",
      marketing: false,
      privacyNotice: PRIVACY_NOTICE_VERSION,
    },
    files: files.map((file) => ({
      id: file.id,
      kind: file.kind,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: Number(file.size_bytes),
    })),
    formsUrl: `${base}/studio?brief=${encodeURIComponent(row.id)}`,
  };
}

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Deliver one submitted free example request at most once.
 * Never throws; the outcome is stored on the row.
 */
export async function deliverToLeads(
  sql: Sql,
  briefId: string,
  deps: LeadsSyncDeps,
  options: { manual?: boolean } = {},
): Promise<LeadsSyncOutcome> {
  if (!deps.url || deps.secrets.length === 0) {
    await sql`
      update briefs set leads_sync_status = 'not_configured',
        leads_sync_error = 'Leads is not connected on this deployment (LEADS_APP_URL / FORMS_INTEGRATION_SECRET).'
      where id = ${briefId} and form_kind = ${FORM_KIND} and status in ('new', 'reviewed')
        and leads_sync_status in ('pending', 'failed', 'not_configured')
    `;
    return "not-configured";
  }
  const claimed = await sql.query<Row>(
    `update briefs
       set leads_sync_status = 'sending', leads_sync_claimed_at = now(), leads_sync_attempts = leads_sync_attempts + 1
     where id = $1
       and form_kind = $5
       and status in ('new', 'reviewed')
       and ($2::boolean or leads_sync_attempts < $3)
       and (
         leads_sync_status in ('pending', 'failed', 'not_configured')
         or (leads_sync_status = 'sending' and leads_sync_claimed_at < now() - ($4::int * interval '1 minute'))
       )
     returning id, reference, payload, campaign_ref, submitted_at`,
    [briefId, options.manual === true, MAX_AUTO_DELIVERIES, STALE_DELIVERY_MINUTES, FORM_KIND],
  );
  const row = claimed[0];
  if (!row) return "not-eligible";

  let outcome: { ok: true; detail: string } | { ok: false; detail: string };
  try {
    const files = await sql<{ id: string; kind: string; filename: string; mime: string; size_bytes: number }>`
      select id, kind, filename, mime, size_bytes from brief_files where brief_id = ${row.id} order by created_at asc
    `;
    const body = JSON.stringify(deliveryPayload(row, files, deps.siteUrl));
    const target = new URL(deps.url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [IDEMPOTENCY_HEADER]: row.id,
      ...signedHeaders(deps.secrets[0]!, "POST", target.pathname + target.search, body, deps.now?.() ?? Date.now()),
    };
    if (deps.bypass) headers["x-vercel-protection-bypass"] = deps.bypass;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await (deps.fetch ?? fetch)(target, { method: "POST", headers, body, signal: controller.signal, redirect: "error" });
      const text = (await response.text().catch(() => "")).slice(0, 400);
      outcome = response.ok ? { ok: true, detail: `${response.status} ${text}`.trim() } : { ok: false, detail: `Leads answered ${response.status}: ${text}`.trim() };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    outcome = { ok: false, detail: `Could not reach Leads — ${describe(error)}` };
  }

  if (outcome.ok) {
    await sql`
      update briefs set leads_sync_status = 'delivered', leads_synced_at = now(), leads_sync_error = null,
        leads_sync_response = ${outcome.detail.slice(0, 400)}
      where id = ${row.id} and leads_sync_status = 'sending'
    `;
    console.log(`[leads-sync] ${row.reference} delivered to PeakSwift Leads`);
    return "delivered";
  }
  console.error(`[leads-sync] ${row.reference} not delivered: ${outcome.detail}`);
  await sql`
    update briefs set leads_sync_status = 'failed', leads_sync_error = ${outcome.detail.slice(0, 400)}
    where id = ${row.id} and leads_sync_status = 'sending'
  `;
  return "failed";
}

/** Retry undelivered requests, oldest first. Used by the scheduled job and after each new submission. */
export async function retryLeadsDeliveries(
  sql: Sql,
  deps: LeadsSyncDeps,
  limit = 10,
  exceptId = "",
): Promise<{ attempted: number; delivered: number; failed: number }> {
  const result = { attempted: 0, delivered: 0, failed: 0 };
  if (!deps.url || deps.secrets.length === 0) return result;
  const rows = await sql.query<{ id: string }>(
    `select id from briefs
     where form_kind = $1 and status in ('new', 'reviewed') and id <> $5
       and leads_sync_attempts < $2
       and (
         leads_sync_status in ('pending', 'failed', 'not_configured')
         or (leads_sync_status = 'sending' and leads_sync_claimed_at < now() - ($3::int * interval '1 minute'))
       )
     order by submitted_at asc
     limit $4`,
    [FORM_KIND, MAX_AUTO_DELIVERIES, STALE_DELIVERY_MINUTES, limit, exceptId],
  );
  for (const row of rows) {
    const outcome = await deliverToLeads(sql, row.id, deps);
    if (outcome === "not-eligible") continue;
    result.attempted += 1;
    if (outcome === "delivered") result.delivered += 1;
    if (outcome === "failed") result.failed += 1;
  }
  return result;
}
