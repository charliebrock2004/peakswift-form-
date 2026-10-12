import { SELF_SEND_NOTE } from "../lib/onboarding/mail-errors.ts";
import type { MailConfig, MailDiagnosis, SendMail } from "./mailer.ts";

export type EmailStatus = {
  configured: boolean;
  problem: string | null;
  sender: string | null;
  recipient: string | null;
  sendsToItself: boolean;
  note: string | null;
};

export type TestEmailResult =
  | { ok: true; response: string; messageId: string; sender: string; recipient: string; note: string | null }
  | { ok: false; error: string };

/** What Studio shows about email. Addresses only; never the password. */
export function emailStatusFrom(diagnosis: MailDiagnosis): EmailStatus {
  const config = diagnosis.config;
  const sendsToItself = Boolean(config && config.user.toLowerCase() === config.to.toLowerCase());
  return {
    configured: Boolean(config),
    problem: diagnosis.problem,
    sender: config?.from ?? null,
    recipient: config?.to ?? null,
    sendsToItself,
    note: sendsToItself ? SELF_SEND_NOTE : null,
  };
}

/**
 * Sends one real test email through the same transport as client
 * notifications and reports the mail server's exact answer.
 */
export async function runTestEmail(
  config: MailConfig | null,
  problem: string | null,
  send: SendMail | null,
  describe: (error: unknown) => string,
  now: Date = new Date(),
): Promise<TestEmailResult> {
  if (!config || !send) return { ok: false, error: problem ?? "Email is not configured." };
  const stamp = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  try {
    const receipt = await send({
      to: config.to,
      from: config.from,
      subject: `PeakSwift test email — ${stamp}`,
      text: [
        "This is a test from PeakSwift Studio.",
        "",
        "If you can read this, client enquiry notifications are being delivered to this inbox.",
        `Sent: ${stamp}`,
      ].join("\n"),
      html: `<p>This is a test from PeakSwift Studio.</p><p>If you can read this, client enquiry notifications are being delivered to this inbox.</p><p style="color:#6b6b6b">Sent: ${stamp}</p>`,
    });
    return {
      ok: true,
      response: receipt.response,
      messageId: receipt.messageId,
      sender: config.from,
      recipient: config.to,
      note: config.user.toLowerCase() === config.to.toLowerCase() ? SELF_SEND_NOTE : null,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
