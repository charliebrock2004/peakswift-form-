import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { isFileKind, isSafeSvg, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, safeFilename, sniffImage } from "@/lib/onboarding/files";
import { legacyAnswers, mergeBrief, validateBrief, type Brief, type FileKind, type SummaryRow } from "@/lib/onboarding/model";
import { HttpError } from "@/server/errors";
import { resolveEmailSetup } from "@/server/email-transport";
import { DEFAULT_NOTIFY_TO } from "@/server/mailer";
import { notifyBrief, retryPendingNotifications, type NotifyDeps, type NotifyOutcome } from "@/server/notify";
import { cleanCampaignRef, FORM_KIND as EXAMPLE_KIND, mergeExampleRequest, validateExampleRequest, type ExampleRequest } from "@/lib/onboarding/example-model";
import { deliverToLeads, leadsSyncConfig, retryLeadsDeliveries, type LeadsSyncDeps, type LeadsSyncOutcome } from "@/server/leads-sync";
import { hasStudioSession, sessionFromCookie, sha256, timingSafeHex } from "@/server/session.server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export { HttpError };

function referenceCode(): string {
  const bytes = randomBytes(6);
  let out = "PS-";
  for (let i = 0; i < bytes.length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) {
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return null;
}

type BriefRow = {
  id: string;
  reference: string;
  status: string;
  business_name: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  payload: Brief | string;
  submitted_at: string | Date | null;
  created_at: string | Date;
  file_count?: number;
  notification_status: string;
  notification_error: string | null;
  notification_sent_at?: string | Date | null;
  notification_message_id?: string | null;
  notification_response?: string | null;
  form_kind?: string;
  campaign_ref?: string;
  leads_sync_status?: string;
  leads_sync_error?: string | null;
  leads_synced_at?: string | Date | null;
};

function parsePayload(value: Brief | string): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function stamp(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

async function requireStudioUser(): Promise<void> {
  if (!(await hasStudioSession())) throw new HttpError(401, "Open Studio with your access code first.");
}

/** Shared by both forms: tidy old drafts, rate limit, then open an upload session. */
async function startSubmission(row: {
  formKind: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  payload: unknown;
  campaignRef?: string;
}): Promise<{ token: string; reference: string }> {
  const sql = await getSql();
  await sql`delete from briefs where status = 'draft' and created_at < now() - interval '2 hours'`;
  const recent = await sql<{ n: number }>`
    select count(*)::int as n from briefs where created_at > now() - interval '1 hour'
  `;
  if ((recent[0]?.n ?? 0) >= 40) {
    throw new HttpError(429, "Too many submissions just now. Please try again in a little while.");
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  let reference = referenceCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    try {
      await sql.query(
        `insert into briefs (
          id, reference, status, upload_token_hash, upload_expires_at,
          business_name, client_name, client_email, client_phone, payload,
          form_kind, campaign_ref, leads_sync_status
        ) values ($1, $2, 'draft', $3, now() + interval '45 minutes', $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          id,
          reference,
          tokenHash,
          row.businessName,
          row.contactName,
          row.email,
          row.phone,
          JSON.stringify(row.payload),
          row.formKind,
          row.campaignRef ?? "",
          row.formKind === EXAMPLE_KIND ? "pending" : "not_applicable",
        ],
      );
      return { token, reference };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/unique|duplicate/i.test(message) || attempt === 4) throw error;
      reference = referenceCode();
    }
  }
  throw new HttpError(500, "Could not start the submission. Please try again.");
}

export async function createBrief(input: unknown, confirmed: boolean): Promise<{ token: string; reference: string }> {
  if (confirmed !== true) throw new HttpError(400, "Confirm the information is accurate before sending.");
  const parsed = validateBrief(input);
  if (!parsed.ok) throw new HttpError(400, "Check the highlighted fields.", parsed.errors);
  const brief = parsed.brief;
  return startSubmission({
    formKind: "project",
    businessName: brief.businessName,
    contactName: brief.contactName,
    email: brief.email,
    phone: brief.phone,
    payload: brief,
  });
}

/** The free website homepage example form. Files and finalise reuse the brief routes. */
export async function createExampleRequest(input: unknown, confirmed: boolean, campaignRef: unknown): Promise<{ token: string; reference: string }> {
  if (confirmed !== true) throw new HttpError(400, "Tick the box to confirm before sending.");
  const parsed = validateExampleRequest(input);
  if (!parsed.ok) throw new HttpError(400, "Check the highlighted fields.", parsed.errors);
  const request = parsed.request;
  return startSubmission({
    formKind: EXAMPLE_KIND,
    businessName: request.businessName,
    contactName: request.contactName,
    email: request.email,
    phone: "",
    payload: request,
    campaignRef: cleanCampaignRef(campaignRef),
  });
}

async function briefForToken(token: string) {
  if (!token || token.length < 20) throw new HttpError(400, "This upload session is missing. Submit the form again.");
  const sql = await getSql();
  const rows = await sql<{ id: string; reference: string; status: string; upload_token_hash: string | null }>`
    select id, reference, status, upload_token_hash from briefs
    where upload_token_hash = ${sha256(token)} and upload_expires_at > now()
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.upload_token_hash || !timingSafeHex(row.upload_token_hash, sha256(token))) {
    throw new HttpError(400, "This upload session has expired. Submit the form again.");
  }
  if (row.status !== "draft") throw new HttpError(400, "This form has already been sent.");
  return row;
}

export async function addBriefFile(token: string, kind: string, filename: string, bytes: Uint8Array): Promise<{ id: string; filename: string }> {
  if (!isFileKind(kind)) throw new HttpError(400, "That file category isn't valid.");
  if (bytes.byteLength === 0) throw new HttpError(400, "That file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new HttpError(400, "One of the files is still too large. Try a smaller photo.");
  }
  const mime = sniffImage(bytes);
  if (!mime) throw new HttpError(400, "Use a JPG, PNG, WEBP or SVG file.");
  if (mime === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes);
    if (!isSafeSvg(text)) throw new HttpError(400, "That SVG couldn't be accepted. Export it as a PNG instead.");
  }
  const row = await briefForToken(token);
  const sql = await getSql();
  const counts = await sql<{ n: number; total: number }>`
    select count(*)::int as n, coalesce(sum(size_bytes), 0)::int as total
    from brief_files where brief_id = ${row.id}
  `;
  const count = counts[0]?.n ?? 0;
  const total = counts[0]?.total ?? 0;
  if (count >= MAX_FILES) throw new HttpError(400, "That's more files than this form can take. Send the rest separately.");
  if (total + bytes.byteLength > MAX_TOTAL_BYTES) {
    throw new HttpError(400, "Those photos together are too large. Send the extras separately.");
  }
  const id = crypto.randomUUID();
  const storedName = safeFilename(filename, mime);
  await sql.query(
    `insert into brief_files (id, brief_id, kind, filename, mime, size_bytes, data)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, row.id, kind as FileKind, storedName, mime, bytes.byteLength, bytes],
  );
  return { id, filename: storedName };
}

function siteUrl(origin?: string): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured && /^https?:\/\//.test(configured)) return configured;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  return origin || "http://localhost:8080";
}

function notificationDeps(origin?: string): NotifyDeps {
  const transport = resolveEmailSetup().transport;
  return {
    send: transport?.send ?? null,
    from: transport?.from ?? "",
    to: transport?.to ?? DEFAULT_NOTIFY_TO,
    siteUrl: siteUrl(origin),
    describeError: (error) => (transport ? transport.describeError(error) : String(error)),
  };
}

function leadsDeps(origin?: string): LeadsSyncDeps {
  const config = leadsSyncConfig();
  return { url: config.url, secrets: config.secrets, bypass: config.bypass, siteUrl: siteUrl(origin) };
}

/** Never throws: the request is already saved, so a Leads problem must not fail the submission. */
async function deliverSafely(id: string, reference: string, origin?: string): Promise<LeadsSyncOutcome | "error"> {
  try {
    const sql = await getSql();
    const deps = leadsDeps(origin);
    const outcome = await deliverToLeads(sql, id, deps);
    if (outcome === "not-configured") console.warn(`[leads-sync] Leads is not connected; ${reference} is saved and waiting in Studio.`);
    // While we are here, catch up on any earlier request Leads missed.
    if (outcome === "delivered") await retryLeadsDeliveries(sql, deps, 3, id).catch(() => undefined);
    return outcome;
  } catch (error) {
    console.error(`[leads-sync] could not process ${reference}:`, error instanceof Error ? error.message : error);
    return "error";
  }
}

/** Never throws: the brief is already saved, so an email problem must not fail the submission. */
async function notifySafely(id: string, reference: string, origin?: string): Promise<NotifyOutcome | "error"> {
  try {
    const outcome = await notifyBrief(await getSql(), id, notificationDeps(origin));
    if (outcome === "not-configured") {
      console.warn(`[notify] email is not configured; ${reference} is saved and waiting in Studio.`);
    }
    return outcome;
  } catch (error) {
    console.error(`[notify] could not process ${reference}:`, error instanceof Error ? error.message : error);
    return "error";
  }
}

/**
 * Marks the brief as submitted, then emails PeakSwift.
 *
 * Idempotent for the upload token's lifetime: a retried request (for example
 * after a dropped connection) gets the same reference back and never causes a
 * second email, because notifyBrief only sends from pending/failed.
 */
export async function finaliseBrief(token: string, origin?: string): Promise<{ reference: string }> {
  if (!token || token.length < 20) throw new HttpError(400, "This upload session is missing. Submit the form again.");
  const sql = await getSql();
  const rows = await sql<{ id: string; reference: string; status: string; upload_token_hash: string | null; form_kind: string }>`
    select id, reference, status, upload_token_hash, form_kind from briefs
    where upload_token_hash = ${sha256(token)} and upload_expires_at > now()
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.upload_token_hash || !timingSafeHex(row.upload_token_hash, sha256(token))) {
    throw new HttpError(400, "This upload session has expired. Submit the form again.");
  }
  if (row.status === "draft") {
    // The status guard makes this a single winner even under concurrent requests.
    await sql`
      update briefs set status = 'new', submitted_at = now()
      where id = ${row.id} and status = 'draft'
    `;
  }
  // Leads first: when it accepts the request it notifies the owner itself,
  // and the Forms email below steps aside instead of duplicating it.
  if (row.form_kind === EXAMPLE_KIND) await deliverSafely(row.id, row.reference, origin);
  await notifySafely(row.id, row.reference, origin);
  return { reference: row.reference };
}

/** Scheduled retry for emails that failed or were sent before email was configured. */
export async function retryNotifications(origin?: string) {
  return retryPendingNotifications(await getSql(), notificationDeps(origin));
}

/** Scheduled retry for free example requests PeakSwift Leads has not accepted yet. */
export async function retryLeadsSync(origin?: string) {
  return retryLeadsDeliveries(await getSql(), leadsDeps(origin));
}

/** Studio's "Send to PeakSwift Leads". Safe to repeat: Leads applies each request once. */
export async function resendToLeads(id: string, origin?: string): Promise<LeadsSyncOutcome> {
  await requireStudioUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That request could not be found.");
  const sql = await getSql();
  const rows = await sql<{ leads_sync_status: string }>`select leads_sync_status from briefs where id = ${id} and form_kind = ${EXAMPLE_KIND} and status in ('new', 'reviewed')`;
  if (!rows[0]) throw new HttpError(404, "That request could not be found.");
  const deps = leadsDeps(origin);
  if (!deps.url) throw new HttpError(503, `PeakSwift Leads isn’t connected: ${leadsSyncConfig().problem}.`);
  // A delivered request may be sent again (Leads ignores the repeat); reopen it for the claim.
  if (rows[0].leads_sync_status === "delivered") {
    await sql`update briefs set leads_sync_status = 'pending' where id = ${id} and leads_sync_status = 'delivered'`;
  }
  const outcome = await deliverToLeads(sql, id, deps, { manual: true });
  if (outcome === "not-eligible") throw new HttpError(409, "That request is being sent to Leads right now.");
  return outcome;
}

/** Studio's "Retry email" button. Only pending or failed emails can be sent, so it never duplicates. */
export async function resendBriefNotification(id: string, origin?: string): Promise<NotifyOutcome> {
  await requireStudioUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That brief could not be found.");
  const deps = notificationDeps(origin);
  if (!deps.send) throw new HttpError(503, "Email isn’t configured yet. Add RESEND_API_KEY in Vercel and redeploy.");
  const outcome = await notifyBrief(await getSql(), id, deps, { manual: true });
  if (outcome === "not-eligible") throw new HttpError(409, "That email has already been sent or is being sent now.");
  return outcome;
}

export type BriefSummary = {
  id: string;
  reference: string;
  status: string;
  businessName: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  submittedAt: string | null;
  fileCount: number;
  notificationStatus: string;
  notificationError: string | null;
  notificationSentAt: string | null;
  notificationMessageId: string | null;
  notificationResponse: string | null;
  formKind: "project" | "free_example";
  campaignRef: string;
  leadsSyncStatus: string;
  leadsSyncError: string | null;
  leadsSyncedAt: string | null;
};

function kindFields(row: BriefRow) {
  return {
    formKind: (row.form_kind === EXAMPLE_KIND ? EXAMPLE_KIND : "project") as BriefSummary["formKind"],
    campaignRef: row.campaign_ref ?? "",
    leadsSyncStatus: row.leads_sync_status ?? "not_applicable",
    leadsSyncError: row.leads_sync_error ?? null,
    leadsSyncedAt: stamp(row.leads_synced_at ?? null),
  };
}

export async function listBriefs(): Promise<BriefSummary[]> {
  await requireStudioUser();
  const sql = await getSql();
  const rows = await sql<BriefRow>`
    select b.id, b.reference, b.status, b.business_name, b.client_name, b.client_email, b.client_phone,
      b.submitted_at, b.created_at, b.notification_status, b.notification_error,
      b.notification_sent_at, b.notification_message_id, b.notification_response,
      b.form_kind, b.campaign_ref, b.leads_sync_status, b.leads_sync_error, b.leads_synced_at,
      (select count(*)::int from brief_files f where f.brief_id = b.id) as file_count
    from briefs b
    where b.status in ('new', 'reviewed')
    order by b.submitted_at desc nulls last
  `;
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    businessName: row.business_name,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    submittedAt: stamp(row.submitted_at),
    fileCount: Number(row.file_count ?? 0),
    notificationStatus: row.notification_status,
    notificationError: row.notification_error,
    notificationSentAt: stamp(row.notification_sent_at ?? null),
    notificationMessageId: row.notification_message_id ?? null,
    notificationResponse: row.notification_response ?? null,
    ...kindFields(row),
  }));
}

export type StoredFile = {
  id: string;
  kind: FileKind;
  filename: string;
  mime: string;
  sizeBytes: number;
};

export async function readBrief(id: string): Promise<{
  summary: BriefSummary;
  brief: Brief;
  legacy: SummaryRow[];
  files: StoredFile[];
  example: ExampleRequest | null;
}> {
  await requireStudioUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That brief could not be found.");
  const sql = await getSql();
  const rows = await sql<BriefRow>`
    select id, reference, status, business_name, client_name, client_email, client_phone,
      payload, submitted_at, created_at, notification_status, notification_error,
      notification_sent_at, notification_message_id, notification_response,
      form_kind, campaign_ref, leads_sync_status, leads_sync_error, leads_synced_at
    from briefs
    where id = ${id} and status in ('new', 'reviewed')
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, "That brief could not be found.");
  const payload = parsePayload(row.payload);
  const files = await sql<{ id: string; kind: FileKind; filename: string; mime: string; size_bytes: number }>`
    select id, kind, filename, mime, size_bytes
    from brief_files
    where brief_id = ${id}
    order by created_at asc
  `;
  return {
    summary: {
      id: row.id,
      reference: row.reference,
      status: row.status,
      businessName: row.business_name,
      clientName: row.client_name,
      clientEmail: row.client_email,
      clientPhone: row.client_phone,
      submittedAt: stamp(row.submitted_at),
      fileCount: files.length,
      notificationStatus: row.notification_status,
      notificationError: row.notification_error,
      notificationSentAt: stamp(row.notification_sent_at ?? null),
      notificationMessageId: row.notification_message_id ?? null,
      notificationResponse: row.notification_response ?? null,
      ...kindFields(row),
    },
    example: row.form_kind === EXAMPLE_KIND ? mergeExampleRequest(payload) : null,
    brief: mergeBrief(payload),
    legacy: row.form_kind === EXAMPLE_KIND ? [] : legacyAnswers(payload),
    files: files.map((file) => ({
      id: file.id,
      kind: file.kind,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: Number(file.size_bytes),
    })),
  };
}

export async function setBriefStatus(id: string, status: string): Promise<void> {
  await requireStudioUser();
  if (status !== "new" && status !== "reviewed") throw new HttpError(400, "That status isn't valid.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That brief could not be found.");
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update briefs set status = ${status}
    where id = ${id} and status in ('new', 'reviewed')
    returning id
  `;
  if (!rows[0]) throw new HttpError(404, "That brief could not be found.");
}

/**
 * One private image for PeakSwift Leads, which asked with a signed request
 * (the route verifies it). Only free example request files are served, and
 * only once the request was submitted.
 */
export async function readExampleFileForLeads(fileId: string): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new HttpError(404, "That file could not be found.");
  const sql = await getSql();
  const rows = await sql<{ filename: string; mime: string; data: unknown }>`
    select f.filename, f.mime, f.data
    from brief_files f
    join briefs b on b.id = f.brief_id
    where f.id = ${fileId} and b.form_kind = ${EXAMPLE_KIND} and b.status in ('new', 'reviewed')
    limit 1
  `;
  const row = rows[0];
  const bytes = row ? asBytes(row.data) : null;
  if (!row || !bytes) throw new HttpError(404, "That file could not be found.");
  return { filename: row.filename, mime: row.mime, bytes };
}

export async function readBriefFile(
  fileId: string,
  request: Request,
): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  if (!(await sessionFromCookie(request.headers.get("cookie")))) {
    throw new HttpError(401, "Open Studio with your access code first.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new HttpError(404, "That file could not be found.");
  const sql = await getSql();
  const rows = await sql<{ filename: string; mime: string; data: unknown }>`
    select f.filename, f.mime, f.data
    from brief_files f
    join briefs b on b.id = f.brief_id
    where f.id = ${fileId} and b.status in ('new', 'reviewed')
    limit 1
  `;
  const row = rows[0];
  const bytes = row ? asBytes(row.data) : null;
  if (!row || !bytes) throw new HttpError(404, "That file could not be found.");
  return { filename: row.filename, mime: row.mime, bytes };
}
