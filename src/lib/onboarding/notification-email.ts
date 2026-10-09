import { briefSections, missingAnswers, type Brief, type FileKind } from "./model.ts";
import { formatBytes } from "./files.ts";

export type EmailFile = { kind: FileKind; filename: string; sizeBytes: number };

export type NotificationInput = {
  brief: Brief;
  reference: string;
  submittedAt: Date;
  files: EmailFile[];
  /** Studio link for this brief. Opening it still requires the Studio access code. */
  studioUrl: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

const KIND_LABEL: Record<FileKind, string> = {
  logo: "Logo",
  work: "Photo",
  team: "Team photo",
  other: "Other image",
  review: "Review screenshot",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Header-safe single line: no CR/LF, bounded length. */
function headerText(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function formatSubmittedAt(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

export function notificationSubject(brief: Brief, reference: string): string {
  const name = headerText(brief.businessName, 120) || "Unnamed business";
  return `New Website Enquiry — ${name} — ${reference}`;
}

export function renderNotificationEmail(input: NotificationInput): RenderedEmail {
  const { brief, reference, files, studioUrl } = input;
  const when = formatSubmittedAt(input.submittedAt);
  const sections = briefSections(brief);
  const missing = missingAnswers(brief);
  const fileLines = files.map((file) => `${KIND_LABEL[file.kind] ?? "File"}: ${file.filename} (${formatBytes(file.sizeBytes)})`);

  // Plain text part
  const text: string[] = [
    `New website enquiry from ${brief.businessName || "an unnamed business"}`,
    "",
    `Reference: ${reference}`,
    `Submitted: ${when}`,
    "",
  ];
  for (const section of sections) {
    text.push(section.title.toUpperCase(), "-".repeat(section.title.length));
    for (const row of section.rows) text.push(`${row.label}: ${row.value.trim() || "Not provided"}`);
    if (section.list) {
      text.push(`${section.list.label}:`);
      if (section.list.items.length) section.list.items.forEach((item) => text.push(`  • ${item}`));
      else text.push("  Not provided");
    }
    text.push("");
  }
  text.push("UPLOADED FILES", "--------------");
  if (fileLines.length) fileLines.forEach((line) => text.push(`  • ${line}`));
  else text.push("  None uploaded");
  text.push("", "NOT SUPPLIED", "------------");
  text.push(missing.length ? missing.map((item) => `  • ${item}`).join("\n") : "  Everything was answered.");
  text.push("", `Open in Studio (access code required): ${studioUrl}`, "", "Files are kept private and are only viewable from Studio.");

  // HTML part
  const cell = "padding:6px 12px 6px 0;vertical-align:top;font-size:14px;line-height:1.5;";
  const label = `${cell}color:#6b6b6b;width:38%;`;
  const value = (raw: string) =>
    raw.trim()
      ? `<td style="${cell}color:#111;white-space:pre-wrap;word-break:break-word;">${escapeHtml(raw.trim())}</td>`
      : `<td style="${cell}color:#9a9a9a;font-style:italic;">Not provided</td>`;
  const heading = (title: string) =>
    `<h2 style="margin:28px 0 8px;font-size:16px;font-weight:600;color:#111;border-bottom:1px solid #e5e2dc;padding-bottom:6px;">${escapeHtml(title)}</h2>`;
  const list = (items: string[], empty: string) =>
    items.length
      ? `<ul style="margin:4px 0 0;padding-left:20px;font-size:14px;line-height:1.6;color:#111;">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p style="margin:4px 0 0;font-size:14px;color:#9a9a9a;font-style:italic;">${escapeHtml(empty)}</p>`;

  const body: string[] = [];
  for (const section of sections) {
    body.push(heading(section.title));
    body.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">`);
    for (const row of section.rows) body.push(`<tr><td style="${label}">${escapeHtml(row.label)}</td>${value(row.value)}</tr>`);
    body.push("</table>");
    if (section.list) {
      body.push(`<p style="margin:10px 0 0;font-size:14px;color:#6b6b6b;">${escapeHtml(section.list.label)}</p>`);
      body.push(list(section.list.items, "Not provided"));
    }
  }
  body.push(heading("Uploaded files"));
  body.push(list(fileLines, "None uploaded"));
  if (files.length) {
    body.push(`<p style="margin:8px 0 0;font-size:13px;color:#6b6b6b;">Files are private. View or download them in Studio.</p>`);
  }
  body.push(heading("Not supplied"));
  body.push(list(missing, "Everything was answered."));

  const safeStudio = escapeHtml(studioUrl);
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4f0;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="background:#ffffff;border:1px solid #e5e2dc;border-radius:12px;padding:24px;">
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;">PeakSwift · New website enquiry</p>
<h1 style="margin:8px 0 4px;font-size:24px;line-height:1.25;color:#111;">${escapeHtml(brief.businessName || "Unnamed business")}</h1>
<p style="margin:0;font-size:14px;color:#444;">${escapeHtml([brief.contactName, brief.email, brief.phone].filter(Boolean).join(" · "))}</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b6b6b;">Reference <strong style="font-family:Menlo,Consolas,monospace;color:#111;">${escapeHtml(reference)}</strong> · ${escapeHtml(when)}</p>
<p style="margin:20px 0 0;"><a href="${safeStudio}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Open in Studio</a></p>
${body.join("\n")}
<p style="margin:28px 0 0;font-size:12px;color:#9a9a9a;">Studio requires your access code. Reply to this email to answer the client directly.</p>
</div></div></body></html>`;

  return { subject: notificationSubject(brief, reference), text: text.join("\n"), html };
}
