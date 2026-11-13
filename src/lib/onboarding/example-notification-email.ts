/**
 * The owner's email for a free website example request — deliberately thin.
 *
 * PeakSwift Leads is the primary notification for these (it knows the
 * campaign and links straight to the opportunity). This email is the safety
 * net for when Leads could not be reached, so it says only what is needed to
 * act — business, contact name, town, campaign, a Studio link — and leaves the
 * contact's email address, answers and files behind the Studio login, rather
 * than copying them into a mailbox.
 */
import { formatSubmittedAt } from "./notification-email.ts";
import type { ExampleRequest } from "./example-model.ts";

export type ExampleNotificationInput = {
  request: ExampleRequest;
  reference: string;
  submittedAt: Date;
  fileCount: number;
  campaignRef: string;
  studioUrl: string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function headerText(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function exampleNotificationSubject(request: ExampleRequest, reference: string): string {
  return `Free homepage example request — ${headerText(request.businessName, 120) || "Unnamed business"} — ${reference}`;
}

export function renderExampleNotificationEmail(input: ExampleNotificationInput): { subject: string; text: string; html: string } {
  const { request, reference, studioUrl } = input;
  const when = formatSubmittedAt(input.submittedAt);
  const campaign = input.campaignRef ? `Campaign link ${input.campaignRef}` : "No campaign link (came to the form directly)";
  const rows: [string, string][] = [
    ["Business", request.businessName],
    ["Contact name", request.contactName],
    ["Trade", request.trade],
    ["Town / area", request.area],
    ["Source", campaign],
    ["Files", input.fileCount ? `${input.fileCount} uploaded` : "None"],
  ];
  const text = [
    `New free homepage example request from ${request.businessName || "an unnamed business"}`,
    "",
    `Reference: ${reference}`,
    `Submitted: ${when}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value || "Not provided"}`),
    "",
    `Open in Studio (login required): ${studioUrl}`,
    "",
    "The full answers, contact details and photos are in Studio and PeakSwift Leads. They are not copied into this email.",
  ].join("\n");
  const cell = "padding:6px 12px 6px 0;vertical-align:top;font-size:14px;line-height:1.5;";
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4f0;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="background:#ffffff;border:1px solid #e5e2dc;border-radius:12px;padding:24px;">
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;">PeakSwift · Free homepage example request</p>
<h1 style="margin:8px 0 4px;font-size:22px;line-height:1.25;color:#111;">${escapeHtml(request.businessName || "Unnamed business")}</h1>
<p style="margin:0 0 16px;font-size:13px;color:#6b6b6b;">Reference <strong style="font-family:Menlo,Consolas,monospace;color:#111;">${escapeHtml(reference)}</strong> · ${escapeHtml(when)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
${rows.map(([label, value]) => `<tr><td style="${cell}color:#6b6b6b;width:34%;">${escapeHtml(label)}</td><td style="${cell}color:#111;">${escapeHtml(value || "Not provided")}</td></tr>`).join("\n")}
</table>
<p style="margin:20px 0 0;"><a href="${escapeHtml(studioUrl)}" style="display:inline-block;background:#3142c9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Open in Studio</a></p>
<p style="margin:20px 0 0;font-size:12px;color:#9a9a9a;">The full answers, contact details and photos stay behind the Studio and Leads logins.</p>
</div></div></body></html>`;
  return { subject: exampleNotificationSubject(request, reference), text, html };
}
