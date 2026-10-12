import type { OutgoingMail, SendMail } from "./mailer.ts";

/**
 * Resend transactional email over HTTPS (https://resend.com/docs/api-reference/emails/send-email).
 * No SDK: one fetch call, so there is nothing extra to bundle.
 *
 * Without a verified domain, Resend only delivers from onboarding@resend.dev to
 * the email address the Resend account was created with — so the account must
 * be registered with the notification recipient (PeakSwiftstudio@gmail.com).
 */
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_DEFAULT_FROM = "PeakSwift Enquiries <onboarding@resend.dev>";
const TIMEOUT_MS = 15_000;

export class ResendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ResendError";
    this.status = status;
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * `from` may be a bare address or `Name <address>`. The idempotency key makes
 * Resend itself drop a repeat of the same notification for 24 hours, on top of
 * the database claim that already prevents duplicates.
 */
export function createResendSender(apiKey: string, fetchImpl: FetchLike = fetch): SendMail {
  return async (mail: OutgoingMail) => {
    let response: Response;
    try {
      response = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: mail.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ResendError(0, `Resend did not respond within ${TIMEOUT_MS / 1000} seconds (timeout).`);
      }
      throw new ResendError(0, `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: { id?: unknown; message?: unknown; name?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* non-JSON reply; handled by the status check below */
    }
    if (!response.ok) {
      const detail = typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
      throw new ResendError(response.status, `Resend rejected the email (HTTP ${response.status}): ${detail}`);
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw new ResendError(response.status, "Resend replied without an email id, so acceptance is not confirmed.");
    return { messageId: id, response: `Accepted by Resend (HTTP ${response.status}), email id ${id}` };
  };
}
